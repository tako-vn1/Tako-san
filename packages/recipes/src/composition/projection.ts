import { compareIds } from '../../../domain/src/availability';
import { generateRecipeCandidates, type RecipeCandidate } from '../candidates';
import type { RecipeCatalogSnapshot } from '../catalog';
import type { RecipeDefinition } from '../foundation';
import { readPlanningContext, type PlanningContext } from '../planner-context';
import {
  applyProjectedConsumption,
  createProjectedInventory,
  InventoryProjectionError,
  projectInventoryRows,
  type InventoryLotSnapshot,
  type ProjectedInventory,
  type ProjectedInventoryDelta,
  type ProjectedInventoryRow,
} from '../planner-inventory';
import { ShoppingMealPlanSnapshotSchema, type ShoppingMealPlanSnapshot } from '../shopping-plan-snapshot';
import type { SubstitutionRule } from '../substitutions';
import { getSimpleFood, type SimpleFood } from './simple-foods';

/**
 * T20 multi-component inventory projection. Every component of every meal is evaluated by the
 * existing T02 candidate generator against ONE running projected inventory (T04
 * `applyProjectedConsumption`), in chronological slot order and component order. Stock used by an
 * earlier component is unavailable to a later one, so total shortage per ingredient equals
 * aggregate demand minus inventory, subtracted exactly once. T05 then aggregates the resulting
 * shortages unchanged. There is no parallel shortage arithmetic here and no real-stock mutation.
 */
export type Requirement = RecipeCandidate['requirements'][number];

export interface ProjectionComponent {
  id: string;
  /** `legacy_family` is an unedited V1 family-variant meal; it is projected but never composed. */
  kind: 'recipe' | 'simple_food' | 'legacy_family';
  recipeId: string | null;
  simpleFoodId: string | null;
  family?: LegacyFamilyRef;
}
export interface LegacyFamilyRef { id: string; version: number; variantId: string }
export interface ProjectionSlot {
  slotId: string;
  date: string;
  instant: string;
  servings: number;
  components: readonly ProjectionComponent[];
}
export interface ComponentEvaluation {
  componentId: string;
  slotId: string;
  status: 'covered' | 'needs_shopping' | 'unresolved' | 'not_tracked' | 'unavailable';
  shortages: Requirement[];
  requirements: Requirement[];
  inventoryLineCount: number;
  missingCount: number;
  deltas: readonly ProjectedInventoryDelta[];
}
export interface CompositionProjection {
  components: Map<string, ComponentEvaluation>;
  initialInventory: readonly ProjectedInventoryRow[];
  finalInventory: readonly ProjectedInventoryRow[];
  /** Inventory rows before `untilSlotId` was evaluated (the state Assisted/Auto plan against). */
  inventoryAtStop: readonly ProjectedInventoryRow[] | null;
  skippedPastSlots: string[];
}

export function simpleFoodDefinition(food: SimpleFood): RecipeDefinition | null {
  if (!food.portion) return null;
  // Evaluation vehicle only: never added to a catalog, authority, picker or response.
  return {
    id: `simple-food-${food.id}`, slug: food.id, title: food.title.en, cuisine: 'simple_food', servings: 1,
    cookTimeMinutes: food.prepMinutes, difficulty: 'easy', provenance: { sourceType: 'curated', verificationState: 'unverified' },
    ingredients: [{ ingredientId: food.portion.ingredientId, name: food.title.en, requiredQuantity: food.portion.quantity,
      unit: food.portion.unit, isOptional: false }],
  } as RecipeDefinition;
}

/**
 * The substitution policy is required: projected shopping must honour exactly the substitutes the
 * planner and Auto candidates were judged with. Build it with `evaluationScope(context)`.
 */
export interface EvaluationScope {
  catalog: RecipeCatalogSnapshot;
  householdId: string;
  mode: 'cook_now' | 'shopping_allowed';
  substitutions: readonly SubstitutionRule[];
  approvedSubstitutionIds: readonly string[];
  activeConstraints: readonly string[];
}

/** The evaluation scope of one trusted planning context (same catalog and substitution authority as T04). */
export function evaluationScope(context: PlanningContext): EvaluationScope {
  const source = readPlanningContext(context);
  return { catalog: source.catalog, householdId: source.rankingContext.householdId, mode: 'shopping_allowed',
    substitutions: source.substitutions, approvedSubstitutionIds: source.approvedSubstitutionIds,
    activeConstraints: source.activeConstraints };
}

function generationPolicy(scope: EvaluationScope) {
  return { substitutions: scope.substitutions, approvedSubstitutionIds: scope.approvedSubstitutionIds,
    activeConstraints: scope.activeConstraints };
}

/** Evaluates one definition against the given inventory rows via T02 (shopping_allowed keeps shortages visible). */
export function evaluateDefinition(scope: EvaluationScope, definition: RecipeDefinition,
  rows: readonly ProjectedInventoryRow[] | readonly InventoryLotSnapshot[], date: string, servings: number): RecipeCandidate | null {
  const missing = definition.ingredients.map((line) => line.ingredientId)
    .filter((id) => !scope.catalog.ingredientIds.includes(id));
  const ingredientIds = missing.length ? [...scope.catalog.ingredientIds, ...new Set(missing)] : scope.catalog.ingredientIds;
  const generation = generateRecipeCandidates({
    catalog: { ...scope.catalog, ingredientIds, recipes: [definition], families: [],
      classifications: scope.catalog.classifications.filter((fact) => fact.recipeId === definition.id) },
    inventory: rows.map((row) => ({ ...row, freshness: row.freshness ?? undefined })),
    householdId: scope.householdId, asOfDate: date, requestedServings: servings,
    mode: 'shopping_allowed', allocationPolicy: 'expiry_first', ...generationPolicy(scope),
  });
  return generation.candidates[0] ?? null;
}

/** The exact V1 family variant (T04 lock identity: family ID, version and variant ID), or null. */
export function evaluateLegacyFamily(scope: EvaluationScope, family: LegacyFamilyRef,
  rows: readonly ProjectedInventoryRow[], date: string, servings: number): RecipeCandidate | null {
  const definition = scope.catalog.families.find((entry) => entry.id === family.id);
  if (!definition) return null;
  const generation = generateRecipeCandidates({
    catalog: { ...scope.catalog, recipes: [], families: [definition], classifications: [] },
    inventory: rows.map((row) => ({ ...row, freshness: row.freshness ?? undefined })),
    householdId: scope.householdId, asOfDate: date, requestedServings: servings,
    mode: 'shopping_allowed', allocationPolicy: 'expiry_first', ...generationPolicy(scope),
  });
  return generation.candidates.find((candidate) => candidate.source.kind === 'family' && candidate.source.sourceId === family.id
    && candidate.source.version === family.version && candidate.variant?.id === family.variantId) ?? null;
}

function unresolvedLines(definition: RecipeDefinition): Requirement[] {
  return definition.ingredients.filter((line) => !line.isOptional).map((line, index) => ({
    ingredientId: line.ingredientId, unit: line.unit, isOptional: false, status: 'unresolved', missingQuantity: null,
    sourceLineIndices: [index],
  }) as unknown as Requirement);
}

function statusOf(candidate: RecipeCandidate): ComponentEvaluation['status'] {
  if (candidate.coverage.unresolvedRequiredCount > 0) return 'unresolved';
  return candidate.canCookWithoutBuying ? 'covered' : 'needs_shopping';
}

export function projectCompositions(input: {
  scope: EvaluationScope;
  referenceDate: string;
  inventory: readonly InventoryLotSnapshot[];
  slots: readonly ProjectionSlot[];
  untilSlotId?: string;
}): CompositionProjection {
  const definitions = new Map(input.scope.catalog.recipes.map((recipe) => [recipe.id, recipe]));
  let state: ProjectedInventory = createProjectedInventory(input.inventory, {
    householdId: input.scope.householdId, asOfDate: input.referenceDate,
  });
  const initialInventory = projectInventoryRows(state);
  const components = new Map<string, ComponentEvaluation>();
  const skippedPastSlots: string[] = [];
  let inventoryAtStop: readonly ProjectedInventoryRow[] | null = null;
  const ordered = [...input.slots].sort((a, b) => compareIds(a.instant, b.instant) || compareIds(a.slotId, b.slotId));
  for (const slot of ordered) {
    if (slot.slotId === input.untilSlotId) { inventoryAtStop = projectInventoryRows(state); break; }
    if (slot.date < input.referenceDate) { skippedPastSlots.push(slot.slotId); continue; }
    for (const component of slot.components) {
      const base = { componentId: component.id, slotId: slot.slotId, inventoryLineCount: 0, deltas: [] as ProjectedInventoryDelta[] };
      let candidate: RecipeCandidate | null;
      if (component.kind === 'legacy_family') {
        candidate = component.family
          ? evaluateLegacyFamily(input.scope, component.family, projectInventoryRows(state), slot.date, slot.servings) : null;
        if (!candidate) {
          components.set(component.id, { ...base, status: 'unavailable', shortages: [], requirements: [], missingCount: 0 });
          continue;
        }
      } else {
        let definition: RecipeDefinition | null | undefined;
        if (component.kind === 'recipe') definition = definitions.get(component.recipeId ?? '');
        else {
          const food = getSimpleFood(component.simpleFoodId ?? '');
          if (!food) definition = undefined;
          else if (!food.portion) {
            components.set(component.id, { ...base, status: 'not_tracked', shortages: [], requirements: [], missingCount: 0 });
            continue;
          } else definition = simpleFoodDefinition(food);
        }
        if (!definition) {
          components.set(component.id, { ...base, status: 'unavailable', shortages: [], requirements: [], missingCount: 0 });
          continue;
        }
        candidate = evaluateDefinition(input.scope, definition, projectInventoryRows(state), slot.date, slot.servings);
        if (!candidate) {
          const shortages = unresolvedLines(definition);
          components.set(component.id, { ...base, status: 'unresolved', shortages, requirements: shortages, missingCount: shortages.length });
          continue;
        }
      }
      const shortages = candidate.requirements.filter((requirement) => requirement.missingQuantity !== 0);
      let deltas: readonly ProjectedInventoryDelta[] = [];
      let status = statusOf(candidate);
      try {
        const applied = applyProjectedConsumption(state, candidate, slot.date);
        state = applied.state;
        deltas = applied.deltas;
      } catch (error) {
        if (!(error instanceof InventoryProjectionError)) throw error;
        status = 'unresolved';
      }
      components.set(component.id, {
        ...base, status, shortages, requirements: candidate.requirements, deltas,
        inventoryLineCount: candidate.requirements.filter((requirement) => requirement.direct.lotsUsed.length > 0).length,
        missingCount: shortages.filter((requirement) => !requirement.isOptional).length,
      });
    }
  }
  return { components, initialInventory, finalInventory: projectInventoryRows(state), inventoryAtStop, skippedPastSlots };
}

/**
 * Builds the persisted-shape T05 input for a composed plan: one entry per meal slot whose
 * shortages are the concatenated component shortages from the single running projection.
 */
export function compositionShoppingSnapshot(base: ShoppingMealPlanSnapshot, projection: CompositionProjection,
  slots: readonly ProjectionSlot[]): ShoppingMealPlanSnapshot {
  const withComponents = slots.filter((slot) => slot.components.length > 0);
  const planned = new Set(withComponents.map((slot) => slot.slotId));
  return ShoppingMealPlanSnapshotSchema.parse({
    ...base,
    slots: [...withComponents].sort((a, b) => compareIds(a.instant, b.instant) || compareIds(a.slotId, b.slotId)).map((slot) => {
      const evaluations = slot.components.map((component) => projection.components.get(component.id))
        .filter((value): value is ComponentEvaluation => value !== undefined);
      return {
        id: slot.slotId, date: slot.date, instant: slot.instant,
        ranked: { candidate: { id: `composition:${slot.slotId}` } },
        projectedConsumption: evaluations.flatMap((evaluation) => evaluation.deltas.map(({ householdId }) => ({ householdId }))),
        shortages: evaluations.flatMap((evaluation) => evaluation.shortages.map((shortage) => ({
          ingredientId: shortage.ingredientId, unit: shortage.unit, isOptional: shortage.isOptional, status: shortage.status,
          missingQuantity: shortage.missingQuantity, sourceLineIndices: shortage.sourceLineIndices,
        }))),
      };
    }),
    unplannedSlots: base.unplannedSlots.filter((slot) => !planned.has(slot.id)),
    initialInventorySnapshot: projection.initialInventory.map(({ householdId }) => ({ householdId })),
    projectedFinalInventory: projection.finalInventory,
  });
}
