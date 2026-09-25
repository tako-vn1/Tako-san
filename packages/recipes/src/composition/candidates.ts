import { compareIds } from '../../../domain/src/availability';
import type { MealRole } from '../../../domain/src/meal-composition-api';
import { generateRecipeCandidates, type RecipeCandidate } from '../candidates';
import { resolveRankingPreferences } from '../personalization';
import { readPlanningContext, type PlanningContext } from '../planner-context';
import type { ProjectedInventoryRow } from '../planner-inventory';
import { createRankingEvidenceSnapshot } from '../ranking-evidence';
import { rankRecipeCandidates } from '../ranking';
import { COMPOSITION_BUDGET, type ComposerCandidate, type ComposerEvaluation } from './composer';
import { evaluateDefinition, simpleFoodDefinition } from './projection';
import type { RoleIndex } from './roles';
import { SIMPLE_FOODS, type SimpleFood } from './simple-foods';

export const recipeKey = (id: string) => `recipe:${id}`;
export const simpleFoodKey = (id: string) => `simple_food:${id}`;

export function evaluationFromCandidate(candidate: RecipeCandidate | null, cookMinutes: number | null): ComposerEvaluation {
  if (!candidate) return { coverage: null, missingIngredientIds: [], inventoryIngredientIds: [], ingredientIds: [], cookMinutes };
  const required = candidate.requirements.filter((requirement) => !requirement.isOptional);
  return {
    coverage: required.length ? candidate.coverage.satisfiedRequiredCount / required.length : 1,
    missingIngredientIds: [...new Set(required.filter((requirement) => requirement.status !== 'satisfied').map((item) => item.ingredientId))].sort(compareIds),
    inventoryIngredientIds: [...new Set(candidate.requirements.filter((requirement) => requirement.direct.lotsUsed.length > 0)
      .map((item) => item.ingredientId))].sort(compareIds),
    ingredientIds: [...new Set(candidate.requirements.map((item) => item.ingredientId))].sort(compareIds),
    cookMinutes,
  };
}

export interface SlotFacts {
  date: string;
  instant: string;
  servings: number;
  mealType: 'breakfast' | 'lunch' | 'dinner';
}

/** Safety: with any requested allergen/dietary policy an untracked simple food has unknown safety. */
export function simpleFoodAllowed(food: SimpleFood, hard: ReturnType<typeof resolveRankingPreferences>['hard']): boolean {
  if (hard.some((policy) => policy.allergens.length > 0 || policy.requiredDietaryTags.length > 0)) return false;
  return !hard.some((policy) => food.portion !== null && policy.forbiddenIngredientIds.includes(food.portion.ingredientId));
}

export function evaluateSimpleFood(context: PlanningContext, food: SimpleFood, rows: readonly ProjectedInventoryRow[], slot: SlotFacts) {
  const source = readPlanningContext(context);
  const definition = simpleFoodDefinition(food);
  const candidate = definition ? evaluateDefinition({ catalog: source.catalog, householdId: source.rankingContext.householdId,
    mode: 'shopping_allowed' }, definition, rows, slot.date, slot.servings) : null;
  return evaluationFromCandidate(candidate, food.prepMinutes);
}

/**
 * Builds bounded Assisted/Auto candidates from the authority-fenced planner catalog: recipes whose
 * roles intersect `roles`, evaluated by T02 against the inventory state at this slot and filtered
 * by T03 hard eligibility (allergens, dietary, forbidden, never-recommend, time). Unresolved
 * quantities and wrong meal types are excluded exactly as in the V1 planner.
 */
export function prepareComposerCandidates(input: {
  context: PlanningContext;
  roleIndex: RoleIndex;
  slot: SlotFacts;
  inventory: readonly ProjectedInventoryRow[];
  roles: readonly MealRole[];
  mode: 'cook_now' | 'shopping_allowed';
  excludeKeys: ReadonlySet<string>;
  usedElsewhere: ReadonlySet<string>;
  maxCatalogCandidates?: number;
}): ComposerCandidate[] {
  const source = readPlanningContext(input.context);
  const limit = input.maxCatalogCandidates ?? COMPOSITION_BUDGET.maxCatalogCandidates;
  const recipes = source.catalog.recipes.filter((recipe) => {
    const profile = input.roleIndex.get(recipe.id);
    return profile !== undefined && !input.excludeKeys.has(recipeKey(recipe.id)) && profile.roles.some((role) => input.roles.includes(role));
  }).slice(0, limit);
  const results: ComposerCandidate[] = [];
  if (recipes.length) {
    const generation = generateRecipeCandidates({
      catalog: { ...source.catalog, recipes, families: [] },
      inventory: input.inventory.map((row) => ({ ...row, freshness: row.freshness ?? undefined })),
      householdId: source.rankingContext.householdId, asOfDate: input.slot.date, requestedServings: input.slot.servings,
      mode: input.mode, allocationPolicy: 'expiry_first', substitutions: source.substitutions,
      approvedSubstitutionIds: source.approvedSubstitutionIds, activeConstraints: source.activeConstraints,
    });
    const evidence = source.evidenceProvider ? createRankingEvidenceSnapshot(generation, source.evidenceProvider) : undefined;
    const ranking = rankRecipeCandidates({ generation, context: source.rankingContext, referenceDate: input.slot.date,
      referenceTime: input.slot.instant, profile: source.rankingProfile, evidence });
    for (const ranked of ranking.ranked) {
      const candidate = ranked.candidate;
      if (candidate.source.kind !== 'recipe' || candidate.coverage.unresolvedRequiredCount > 0) continue;
      const mealTypes = candidate.classifications.filter((fact) => fact.kind === 'meal_type').map((fact) => fact.tag);
      if (mealTypes.length && !mealTypes.includes(input.slot.mealType)) continue;
      const profile = input.roleIndex.get(candidate.source.sourceId)!;
      const key = recipeKey(candidate.source.sourceId);
      const preference = Math.min(1, Math.max(0, ranked.finalScore)) * (input.usedElsewhere.has(key) ? 0.7 : 1);
      results.push({ ...evaluationFromCandidate(candidate, candidate.cookTimeMinutes ?? null), key, kind: 'recipe',
        id: candidate.source.sourceId, title: candidate.title, roles: profile.roles.filter((role) => input.roles.includes(role)),
        traits: profile.traits, dominantIngredientId: profile.dominantIngredientId, preference });
    }
  }
  const hard = resolveRankingPreferences(source.rankingContext).hard;
  for (const food of SIMPLE_FOODS) {
    const key = simpleFoodKey(food.id);
    if (input.excludeKeys.has(key) || !food.roles.some((role) => input.roles.includes(role)) || !simpleFoodAllowed(food, hard)) continue;
    const evaluation = evaluateSimpleFood(input.context, food, input.inventory, input.slot);
    if (input.mode === 'cook_now' && evaluation.coverage !== null && evaluation.coverage < 1) continue;
    results.push({ ...evaluation, key, kind: 'simple_food', id: food.id, title: food.title.vi,
      roles: food.roles.filter((role) => input.roles.includes(role)), traits: [], dominantIngredientId: null,
      preference: 0.5 * (input.usedElsewhere.has(key) ? 0.9 : 1) });
  }
  return results.sort((a, b) => compareIds(a.key, b.key));
}
