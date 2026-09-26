import { describe, expect, it } from 'vitest';
import { generateRecipeCandidates } from '../../packages/recipes/src/candidates';
import { RecipeFamilySchema, type RecipeDefinition } from '../../packages/recipes/src/foundation';
import { readPlanningContext, type PlanningSourceInput } from '../../packages/recipes/src/planner-context';
import { createProjectedInventory, projectInventoryRows, type InventoryLotSnapshot } from '../../packages/recipes/src/planner-inventory';
import { rankRecipeCandidates } from '../../packages/recipes/src/ranking';
import { createRankingEvidenceSnapshot } from '../../packages/recipes/src/ranking-evidence';
import { SubstitutionRuleSchema } from '../../packages/recipes/src/substitutions';
import { aggregateShoppingDemand } from '../../packages/recipes/src/shopping-demand';
import { projectShoppingMealPlan } from '../../packages/recipes/src/shopping-plan-snapshot';
import {
  compositionShoppingSnapshot,
  evaluationScope,
  projectCompositions,
  type ProjectionSlot,
} from '../../packages/recipes/src/composition/projection';
import { recipeRestrictions, simpleFoodRestrictions } from '../../packages/recipes/src/composition/restrictions';
import { getSimpleFood } from '../../packages/recipes/src/composition/simple-foods';
import { catalog, context, HOUSEHOLD_ID, lot, nutritionEvidence, recipe, USER_ID } from '../helpers/planner-fixtures';
import { shoppingPlan } from '../helpers/shopping-fixtures';

/**
 * T20 review P1 regressions: one hard-restriction definition for every composition path, the
 * planner's substitution authority in composition shopping, and V1 family meals in the projection.
 */
const DATE = '2026-09-09';
const household = (values: Record<string, unknown>) => ({ householdId: HOUSEHOLD_ID, userId: null, values });
const tofu = (quantity: number) => lot({ id: `lot-tofu-${quantity}`, ingredientId: 'TOFU', quantity, unit: 'g' });
const rows = (lots: InventoryLotSnapshot[]) => projectInventoryRows(createProjectedInventory(lots, { householdId: HOUSEHOLD_ID, asOfDate: '2026-09-08' }));

// Chicken dish with a reviewed tofu substitute; a second dish uses tofu directly.
const chickenDish = recipe('chicken-dish', 'CHICKEN', 300, { prepTimeMinutes: 10 });
const tofuDish = recipe('tofu-dish', 'TOFU', 300, { prepTimeMinutes: 10 });
const substitute = SubstitutionRuleSchema.parse({
  id: 'tofu-for-chicken', scopeType: 'recipe', scopeId: 'chicken-dish', scopeVersion: 1,
  fromIngredientId: 'CHICKEN', toIngredientId: 'TOFU', fromUnit: 'g', toUnit: 'g', quantityRatio: 1,
  reason: 'Reviewed adaptation', sourceReference: 'test:substitution', verificationState: 'reviewed', compatibleWith: [],
});

function planning(overrides: Partial<PlanningSourceInput> = {}) {
  return context({ catalog: catalog([chickenDish, tofuDish]), inventory: [tofu(400)], ...overrides });
}
const slot = (date: string, components: ProjectionSlot['components']): ProjectionSlot =>
  ({ slotId: `${date}:dinner:0`, date, instant: `${date}T12:00:00.000Z`, servings: 2, components });
const recipeComponent = (id: string, recipeId: string) => ({ id, kind: 'recipe' as const, recipeId, simpleFoodId: null });

describe('T20 hard restrictions share the T03 definition', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['required dietary tag without review evidence', { requiredDietaryTags: ['vegetarian'] }, 'SAFETY_UNKNOWN'],
    ['allergen without review evidence', { allergens: ['soy'] }, 'SAFETY_UNKNOWN'],
    ['hard max time exceeded', { hardMaxTimeMinutes: 15 }, 'COOKING_TIME_LIMIT'],
    ['hard nutrition target without reviewed nutrition', { mealNutritionTargets: [{ nutrient: 'proteinG', max: 50, hard: true }] }, 'NUTRITION_UNKNOWN'],
    ['never recommend', { neverRecommendRecipeIds: ['tofu-dish'] }, 'NEVER_RECOMMEND'],
    ['forbidden ingredient', { forbiddenIngredientIds: ['TOFU'] }, 'FORBIDDEN_INGREDIENT'],
  ];
  it.each(cases)('Manual verdict equals T03 ranking exclusion: %s', (_label, values, reason) => {
    const ctx = planning({ rankingContext: { householdId: HOUSEHOLD_ID, userId: USER_ID, preferences: [household(values)], feedback: [] } });
    const manual = recipeRestrictions({ context: ctx, recipe: tofuDish, slot: { date: DATE, servings: 2 }, inventory: rows([tofu(400)]) });
    expect(manual.allowed).toBe(false);
    expect(manual.reasons).toContain(reason);
    // Same candidate through T03 ranking (the Auto/Assisted path) is excluded for the same reasons.
    const source = readPlanningContext(ctx);
    const generation = generateRecipeCandidates({ catalog: { ...source.catalog, recipes: [tofuDish], families: [] },
      inventory: rows([tofu(400)]), householdId: HOUSEHOLD_ID, asOfDate: DATE, requestedServings: 2, mode: 'shopping_allowed',
      allocationPolicy: 'expiry_first' });
    const ranking = rankRecipeCandidates({ generation, context: source.rankingContext, referenceDate: DATE,
      referenceTime: `${DATE}T12:00:00+07:00`, evidence: createRankingEvidenceSnapshot(generation, source.evidenceProvider!) });
    expect(ranking.ranked).toHaveLength(0);
    expect(ranking.excluded[0].reasons).toEqual(manual.reasons);
  });

  it('reviewed evidence inside the hard targets is allowed, identically for both paths', () => {
    const ctx = planning({ evidenceProvider: nutritionEvidence({ proteinG: 20 }),
      rankingContext: { householdId: HOUSEHOLD_ID, userId: USER_ID, feedback: [],
        preferences: [household({ hardMaxTimeMinutes: 60, mealNutritionTargets: [{ nutrient: 'proteinG', max: 50, hard: true }] })] } });
    expect(recipeRestrictions({ context: ctx, recipe: tofuDish, slot: { date: DATE, servings: 2 }, inventory: rows([tofu(400)]) }))
      .toEqual({ allowed: true, reasons: [] });
  });

  it('a forbidden approved substitute is caught at the slot inventory where it would be used', () => {
    const ctx = planning({ substitutions: [substitute], approvedSubstitutionIds: [substitute.id],
      rankingContext: { householdId: HOUSEHOLD_ID, userId: USER_ID, preferences: [household({ forbiddenIngredientIds: ['TOFU'] })], feedback: [] } });
    const withTofu = recipeRestrictions({ context: ctx, recipe: chickenDish, slot: { date: DATE, servings: 2 }, inventory: rows([tofu(400)]) });
    expect(withTofu.reasons).toEqual(['FORBIDDEN_INGREDIENT']);
    // Chicken in stock: the substitute is not used, so the dish is not forbidden.
    const withChicken = recipeRestrictions({ context: ctx, recipe: chickenDish, slot: { date: DATE, servings: 2 },
      inventory: rows([tofu(400), lot({ id: 'lot-chicken', ingredientId: 'CHICKEN', quantity: 1000 })]) });
    expect(withChicken.allowed).toBe(true);
  });

  it('simple foods fail closed on unknown safety, hard nutrition and time; tracked forbidden portions are blocked', () => {
    const rice = getSimpleFood('sf-steamed-rice')!;
    const fruit = getSimpleFood('sf-seasonal-fruit')!;
    const policy = (values: Record<string, unknown>) => [{ ...emptyPolicy(), ...values }];
    expect(simpleFoodRestrictions(fruit, policy({ requiredDietaryTags: ['vegan'] })).reasons).toEqual(['SAFETY_UNKNOWN']);
    expect(simpleFoodRestrictions(rice, policy({ allergens: ['gluten'] })).reasons).toEqual(['SAFETY_UNKNOWN']);
    expect(simpleFoodRestrictions(rice, policy({ mealNutritionTargets: [{ nutrient: 'energyKcal', min: 0, max: 900, hard: true, allowEstimates: false }] })).reasons)
      .toEqual(['NUTRITION_UNKNOWN']);
    expect(simpleFoodRestrictions(rice, policy({ hardMaxTimeMinutes: 20 })).reasons).toEqual(['COOKING_TIME_LIMIT']);
    expect(simpleFoodRestrictions(rice, policy({ forbiddenIngredientIds: ['RICE'] })).reasons).toEqual(['FORBIDDEN_INGREDIENT']);
    expect(simpleFoodRestrictions(fruit, policy({ hardMaxTimeMinutes: 20 })).allowed).toBe(true);
    expect(simpleFoodRestrictions(rice, []).allowed).toBe(true);
  });
});

function emptyPolicy() {
  return { preferredCuisines: [], avoidedCuisines: [], likedIngredientIds: [], dislikedIngredientIds: [], forbiddenIngredientIds: [],
    neverRecommendRecipeIds: [], allergens: [], requiredDietaryTags: [], mealNutritionTargets: [] };
}

describe('T20 composition shopping uses the planner substitution authority', () => {
  function shop(ctx: ReturnType<typeof planning>, slots: ProjectionSlot[], inventory: InventoryLotSnapshot[]) {
    const projection = projectCompositions({ scope: evaluationScope(ctx), referenceDate: '2026-09-08', inventory, slots });
    const snapshot = compositionShoppingSnapshot(projectShoppingMealPlan(shoppingPlan([chickenDish])), projection, slots);
    return { projection, requirements: aggregateShoppingDemand(snapshot) };
  }

  it('approved substitute competes with a direct demand across components: tofu 600 - 400 = 200, no chicken', () => {
    const ctx = planning({ substitutions: [substitute], approvedSubstitutionIds: [substitute.id] });
    const { projection, requirements } = shop(ctx,
      [slot(DATE, [recipeComponent('c-chicken', 'chicken-dish'), recipeComponent('c-tofu', 'tofu-dish')])], [tofu(400)]);
    expect(projection.components.get('c-chicken')!.status).toBe('covered');
    expect(projection.components.get('c-tofu')!.status).toBe('needs_shopping');
    expect(requirements).toEqual([expect.objectContaining({ ingredientId: 'TOFU', unit: 'g', requiredQuantity: 200 })]);
  });

  it('the direct demand in an earlier slot wins stock; the later substitute cannot double count it', () => {
    const ctx = planning({ substitutions: [substitute], approvedSubstitutionIds: [substitute.id] });
    const { projection, requirements } = shop(ctx, [slot(DATE, [recipeComponent('c-tofu', 'tofu-dish')]),
      slot('2026-09-10', [recipeComponent('c-chicken', 'chicken-dish')])], [tofu(400)]);
    expect(projection.components.get('c-tofu')!.status).toBe('covered');
    expect(projection.components.get('c-chicken')!.status).toBe('needs_shopping');
    // Only 100 g tofu remains for the substitute, so the original chicken shortage stays visible.
    expect(requirements.map((item) => item.ingredientId)).toContain('CHICKEN');
    expect(projection.finalInventory.find((row) => row.ingredientId === 'TOFU')!.quantity).toBeLessThan(100.0001);
  });

  it('an unapproved rule is never used: the original ingredient is bought', () => {
    const ctx = planning({ substitutions: [substitute], approvedSubstitutionIds: [] });
    const { projection, requirements } = shop(ctx,
      [slot(DATE, [recipeComponent('c-chicken', 'chicken-dish'), recipeComponent('c-tofu', 'tofu-dish')])], [tofu(400)]);
    expect(projection.components.get('c-chicken')!.status).toBe('needs_shopping');
    expect(requirements).toEqual([expect.objectContaining({ ingredientId: 'CHICKEN', requiredQuantity: 300 })]);
  });
});

describe('T20 V1 family meals stay in the single projection', () => {
  const family = RecipeFamilySchema.parse({ id: 'tofu-stir-fry', slug: 'tofu-stir-fry', name: 'Tofu stir fry', baseServings: 2,
    provenance: { sourceType: 'curated', version: 3, sourceReference: 'test-kitchen:family' },
    slots: [{ key: 'protein', minSelections: 1, maxSelections: 1, options: [{ ingredientId: 'TOFU', quantity: 300, unit: 'g' }] }] });
  const familyCatalog = catalog([tofuDish] as RecipeDefinition[], [], [family]);

  it('a legacy family slot consumes stock before a later composed component (single subtraction)', () => {
    const ctx = context({ catalog: familyCatalog, inventory: [tofu(400)] });
    const scope = evaluationScope(ctx);
    const variant = generateRecipeCandidates({ catalog: { ...scope.catalog, recipes: [] }, inventory: rows([tofu(400)]),
      householdId: HOUSEHOLD_ID, asOfDate: DATE, requestedServings: 2, mode: 'shopping_allowed' }).candidates[0].variant!;
    const legacy = { id: `v1.${DATE}:dinner:0`, kind: 'legacy_family' as const, recipeId: null, simpleFoodId: null,
      family: { id: family.id, version: 3, variantId: variant.id } };
    const slots = [slot(DATE, [legacy]), slot('2026-09-10', [recipeComponent('c-tofu', 'tofu-dish')])];
    const projection = projectCompositions({ scope, referenceDate: '2026-09-08', inventory: [tofu(400)], slots });
    expect(projection.components.get(legacy.id)!.status).toBe('covered');
    const requirements = aggregateShoppingDemand(compositionShoppingSnapshot(projectShoppingMealPlan(shoppingPlan([tofuDish])), projection, slots));
    expect(requirements).toEqual([expect.objectContaining({ ingredientId: 'TOFU', requiredQuantity: 200 })]);

    const stale = { ...legacy, family: { ...legacy.family, variantId: 'not-a-variant' } };
    expect(projectCompositions({ scope, referenceDate: '2026-09-08', inventory: [tofu(400)], slots: [slot(DATE, [stale])] })
      .components.get(legacy.id)!.status).toBe('unavailable');
  });
});
