import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanDtoSchema, PlanShoppingDtoSchema } from '../../packages/domain/src/meal-planning-api';
import {
  AutoOptionsDtoSchema,
  PickerPageDtoSchema,
  PlanCompositionsDtoSchema,
  SlotCompositionDtoSchema,
} from '../../packages/domain/src/meal-composition-api';
import { generateRecipeCandidates } from '../../packages/recipes/src/candidates';
import { createRecipeCatalog } from '../../packages/recipes/src/catalog';
import { RecipeFamilySchema } from '../../packages/recipes/src/foundation';
import { createPlanningContext } from '../../packages/recipes/src/planner-context';
import { SubstitutionRuleSchema } from '../../packages/recipes/src/substitutions';
import { MealPlanningApplicationService } from '../../src/worker/services/meal-planning';
import { resetRecipeAuthorityCacheForTests } from '../../src/worker/services/recipe-authority';
import { resetRoleIndexMemoForTests } from '../../src/worker/services/meal-composition';
import { quietLogs, T20Harness, T20_INTENT } from '../helpers/t20-composition-harness';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));

/**
 * T20 review P1 regressions over the real Worker + SQLite ledger: Manual enforces the full T03 hard
 * contract, and V1 family-variant meals keep V1 controls while staying in composed-plan shopping.
 */
const HOUSE = 't20-p1-a';
const FAMILY_ID = 't20-family-chicken';
const FAMILY_HOST = 'imp-26a36c69306143bc';
const CASE_TIMEOUT = 30_000;
let h: T20Harness;
let events: Array<Record<string, unknown>>;

const slotPath = (planId: string, slotId: string) => `/meal-planning/plans/${planId}/slots/${encodeURIComponent(slotId)}`;
async function generate() {
  const response = await h.call(HOUSE, 'POST', '/meal-planning/plans', T20_INTENT);
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  return MealPlanDtoSchema.parse(response.json);
}
function preferences(values: Record<string, unknown>) {
  h.db.seed(`INSERT INTO household_ranking_preferences (household_id, values_json, updated_at)
    VALUES ('${HOUSE}', '${JSON.stringify({ version: 1, values })}', '2029-01-01T00:00:00.000Z')`);
}
const recipeTarget = (recipeId: string) => ({ kind: 'recipe' as const, recipeId });
const riceTarget = { kind: 'simple_food' as const, simpleFoodId: 'sf-steamed-rice' };
const cucumberTarget = { kind: 'simple_food' as const, simpleFoodId: 'sf-sliced-cucumber' };

async function forbiddenSubstitutionFixture() {
  const plan = await generate();
  const first = plan.result.meals[0];
  expect(first.source.kind).toBe('recipe');
  const picker = await h.call(HOUSE, 'GET', '/meal-planning/compositions/picker?role=vegetable&kind=recipe');
  expect(picker.status, JSON.stringify(picker.json)).toBe(200);
  const candidate = PickerPageDtoSchema.parse(picker.json).items.find((item) => item.id !== first.source.id);
  expect(candidate?.roles).toContain('vegetable');
  const downstreamId = candidate!.id;

  preferences({ forbiddenIngredientIds: ['SHRIMP'] });
  const substitution = SubstitutionRuleSchema.parse({
    id: 't20-tofu-for-shrimp', scopeType: 'recipe', scopeId: downstreamId, scopeVersion: 1,
    fromIngredientId: 'TOFU', toIngredientId: 'SHRIMP', fromUnit: 'piece', toUnit: 'g', quantityRatio: 1,
    reason: 'Reviewed test adaptation', sourceReference: 'test:t20-prefix-safety', verificationState: 'reviewed', compatibleWith: [],
  });
  vi.spyOn(MealPlanningApplicationService.prototype, 'planningContext').mockImplementation((snapshot, referenceInstant) =>
    createPlanningContext(() => ({
      snapshotId: crypto.randomUUID(), referenceInstant, inventory: snapshot.inventory,
      catalog: { ...snapshot.catalog, recipes: snapshot.catalog.recipes.map((recipe) =>
        recipe.id === first.source.id || recipe.id === downstreamId
          ? { ...recipe, servings: first.servings, ingredients: [{ ingredientId: 'TOFU', name: 'Tofu',
            requiredQuantity: 10, unit: 'piece', isOptional: false }] }
          : recipe) },
      rankingContext: snapshot.rankingContext, evidenceProvider: snapshot.evidenceProvider,
      substitutions: [substitution], approvedSubstitutionIds: [substitution.id],
    })));
  return { plan, first, downstreamId, path: slotPath(plan.id, first.slotId) };
}

async function readComposition(path: string) {
  const response = await h.call(HOUSE, 'GET', `${path}/composition`);
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  return SlotCompositionDtoSchema.parse(response.json);
}

async function assertRejectedUnchanged(planId: string, path: string, before: Awaited<ReturnType<typeof readComposition>>,
  response: Awaited<ReturnType<T20Harness['call']>>) {
  expect(response.status, JSON.stringify(response.json)).toBe(422);
  expect(response.json.code).toBe('HARD_CONSTRAINT_CONFLICT');
  expect(await readComposition(path)).toEqual(before);
  const plan = await h.call(HOUSE, 'GET', `/meal-planning/plans/${planId}`);
  expect(MealPlanDtoSchema.parse(plan.json).revision).toBe(before.planRevision);
  expect(events.some((event) => event.event === 'composition_hard_restriction_rejected'
    && String(event.reasons).includes('FORBIDDEN_INGREDIENT'))).toBe(true);
}

beforeEach(async () => {
  h = new T20Harness();
  await h.seedHousehold(HOUSE);
  resetRecipeAuthorityCacheForTests();
  resetRoleIndexMemoForTests();
  events = quietLogs();
});
afterEach(() => {
  h.close();
  vi.restoreAllMocks();
});

describe('T20 Manual enforces the same T03 hard contract as Auto', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['reviewed dietary tag required (safety unknown)', { requiredDietaryTags: ['vegetarian'] }, 'SAFETY_UNKNOWN'],
    ['allergen requested (safety unknown)', { allergens: ['peanut'] }, 'SAFETY_UNKNOWN'],
    ['hard nutrition target without reviewed nutrition', { mealNutritionTargets: [{ nutrient: 'proteinG', max: 80, hard: true }] }, 'NUTRITION_UNKNOWN'],
  ];
  it.each(cases)('%s: Auto adds nothing and Manual cannot persist the dish', async (_label, values, reason) => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    preferences(values);
    const auto = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`, { revision: plan.revision });
    expect(auto.status, JSON.stringify(auto.json)).toBe(200);
    for (const option of AutoOptionsDtoSchema.parse(auto.json).options) {
      expect(option.components.filter((item) => item.existingComponentId === null)).toEqual([]);
    }
    const picker = await h.call(HOUSE, 'GET', '/meal-planning/compositions/picker?role=vegetable&kind=recipe');
    const recipeId = picker.json.items.find((item: { kind: string }) => item.kind === 'recipe').id as string;
    for (const target of [{ kind: 'recipe', recipeId }, { kind: 'simple_food', simpleFoodId: 'sf-sliced-cucumber' }]) {
      const manual = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`, { revision: plan.revision, target, role: 'vegetable' });
      expect(manual.status, JSON.stringify(manual.json)).toBe(422);
      expect(manual.json.code).toBe('HARD_CONSTRAINT_CONFLICT');
    }
    const rejected = events.filter((event) => event.event === 'composition_hard_restriction_rejected');
    expect(rejected.length).toBe(2);
    expect(String(rejected[0].reasons)).toContain(reason);
    // Manual save cannot smuggle it in either; nothing was written.
    const save = await h.call(HOUSE, 'PUT', `${slotPath(plan.id, slotId)}/composition`, { revision: plan.revision, components: [
      { id: `v1.${slotId}`, target: { kind: 'recipe', recipeId: plan.result.meals[0].source.id }, role: 'main', locked: false },
      { target: { kind: 'recipe', recipeId }, role: 'vegetable', locked: false }] });
    expect(save.json.code).toBe('HARD_CONSTRAINT_CONFLICT');
    expect(MealPlanDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}`)).json).revision).toBe(plan.revision);
  }, CASE_TIMEOUT);

  it('rejects a substitution that becomes forbidden after an earlier component consumes direct stock', async () => {
    const { plan, downstreamId, path } = await forbiddenSubstitutionFixture();
    const before = await readComposition(path);
    const manual = await h.call(HOUSE, 'POST', `${path}/components`, {
      revision: plan.revision, target: recipeTarget(downstreamId), role: 'vegetable',
    });
    await assertRejectedUnchanged(plan.id, path, before, manual);
  }, CASE_TIMEOUT);

  it('rejects a swap that makes an existing downstream dish fall back to forbidden shrimp', async () => {
    const { plan, first, downstreamId, path } = await forbiddenSubstitutionFixture();
    const start = await h.call(HOUSE, 'PUT', `${path}/composition`, { revision: plan.revision, components: [
      { id: `v1.${first.slotId}`, target: riceTarget, role: 'staple', locked: false },
      { target: recipeTarget(downstreamId), role: 'vegetable', locked: false },
    ] });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    const before = await readComposition(path);
    const swap = await h.call(HOUSE, 'POST', `${path}/components/${encodeURIComponent(before.composition.components[0].id)}/swap`,
      { revision: before.planRevision, target: recipeTarget(first.source.id), role: 'main' });
    await assertRejectedUnchanged(plan.id, path, before, swap);
  }, CASE_TIMEOUT);

  it('rejects an upstream-slot swap that makes a later slot use forbidden shrimp', async () => {
    const { plan, first, downstreamId, path } = await forbiddenSubstitutionFixture();
    const neutral = await h.call(HOUSE, 'PUT', `${path}/composition`, { revision: plan.revision, components: [
      { id: `v1.${first.slotId}`, target: riceTarget, role: 'staple', locked: false },
    ] });
    expect(neutral.status, JSON.stringify(neutral.json)).toBe(200);
    const nextPath = slotPath(plan.id, plan.result.meals[1].slotId);
    const later = await h.call(HOUSE, 'PUT', `${nextPath}/composition`, {
      revision: SlotCompositionDtoSchema.parse(neutral.json).planRevision, components: [
        { target: recipeTarget(downstreamId), role: 'vegetable', locked: false },
      ],
    });
    expect(later.status, JSON.stringify(later.json)).toBe(200);
    const before = await readComposition(path);
    const laterBefore = await readComposition(nextPath);
    expect(laterBefore.composition.components[0].projection?.status).toBe('covered');
    const swap = await h.call(HOUSE, 'POST', `${path}/components/${encodeURIComponent(before.composition.components[0].id)}/swap`,
      { revision: before.planRevision, target: recipeTarget(first.source.id), role: 'main' });
    await assertRejectedUnchanged(plan.id, path, before, swap);
    expect(await readComposition(nextPath)).toEqual(laterBefore);
  }, CASE_TIMEOUT);

  it('does not rejudge a later dish when an earlier edit changes unrelated inventory', async () => {
    const { plan, first, downstreamId, path } = await forbiddenSubstitutionFixture();
    const neutral = await h.call(HOUSE, 'PUT', `${path}/composition`, { revision: plan.revision, components: [
      { id: `v1.${first.slotId}`, target: riceTarget, role: 'staple', locked: false },
    ] });
    expect(neutral.status, JSON.stringify(neutral.json)).toBe(200);
    const nextPath = slotPath(plan.id, plan.result.meals[1].slotId);
    const later = await h.call(HOUSE, 'PUT', `${nextPath}/composition`, {
      revision: SlotCompositionDtoSchema.parse(neutral.json).planRevision, components: [
        { target: recipeTarget(downstreamId), role: 'vegetable', locked: false },
      ],
    });
    expect(later.status, JSON.stringify(later.json)).toBe(200);
    const before = await readComposition(path);
    const laterBefore = await readComposition(nextPath);
    h.db.seed(`UPDATE household_ranking_preferences
      SET values_json = '{"version":1,"values":{"forbiddenIngredientIds":["TOFU"]}}'
      WHERE household_id = '${HOUSE}'`);
    const swap = await h.call(HOUSE, 'POST', `${path}/components/${encodeURIComponent(before.composition.components[0].id)}/swap`,
      { revision: before.planRevision, target: { kind: 'simple_food', simpleFoodId: 'sf-bread' } });
    expect(swap.status, JSON.stringify(swap.json)).toBe(200);
    const laterAfter = await readComposition(nextPath);
    expect(laterAfter.planRevision).toBe(laterBefore.planRevision + 1);
    expect(laterAfter.composition.components).toEqual(laterBefore.composition.components);
  }, CASE_TIMEOUT);

  it.each(['PATCH reorder', 'PUT replace'] as const)('%s rejects an unsafe inventory-prefix change', async (method) => {
    const { plan, first, downstreamId, path } = await forbiddenSubstitutionFixture();
    const start = await h.call(HOUSE, 'PUT', `${path}/composition`, { revision: plan.revision, components: [
      { target: recipeTarget(downstreamId), role: 'vegetable', locked: false },
      { id: `v1.${first.slotId}`, target: recipeTarget(first.source.id), role: 'main', locked: false },
    ] });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    const before = await readComposition(path);
    const [downstream, upstream] = before.composition.components;
    const rejected = method === 'PATCH reorder'
      ? await h.call(HOUSE, 'PATCH', `${path}/components/${encodeURIComponent(upstream.id)}`,
        { revision: before.planRevision, ordinal: 0 })
      : await h.call(HOUSE, 'PUT', `${path}/composition`, { revision: before.planRevision, components: [
        { id: upstream.id, target: recipeTarget(first.source.id), role: 'main', locked: false },
        { id: downstream.id, target: recipeTarget(downstreamId), role: 'vegetable', locked: false },
      ] });
    await assertRejectedUnchanged(plan.id, path, before, rejected);
  }, CASE_TIMEOUT);

  it('allows a safe reorder of existing components after a stable inventory prefix', async () => {
    const { plan, first, downstreamId, path } = await forbiddenSubstitutionFixture();
    const start = await h.call(HOUSE, 'PUT', `${path}/composition`, { revision: plan.revision, components: [
      { target: recipeTarget(downstreamId), role: 'vegetable', locked: false },
      { id: `v1.${first.slotId}`, target: recipeTarget(first.source.id), role: 'main', locked: false },
      { target: riceTarget, role: 'staple', locked: false },
    ] });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    const before = await readComposition(path);
    const rice = before.composition.components[2];
    const reordered = await h.call(HOUSE, 'PATCH', `${path}/components/${rice.id}`,
      { revision: before.planRevision, ordinal: 1 });
    expect(reordered.status, JSON.stringify(reordered.json)).toBe(200);
    expect(SlotCompositionDtoSchema.parse(reordered.json).composition.components.map((item) => item.id)).toEqual([
      before.composition.components[0].id, rice.id, before.composition.components[1].id,
    ]);
  }, CASE_TIMEOUT);

  it('does not rejudge a stable prefix when only later components move', async () => {
    const { plan, downstreamId, path } = await forbiddenSubstitutionFixture();
    const start = await h.call(HOUSE, 'PUT', `${path}/composition`, { revision: plan.revision, components: [
      { target: recipeTarget(downstreamId), role: 'vegetable', locked: false },
      { target: riceTarget, role: 'staple', locked: false },
      { target: cucumberTarget, role: 'vegetable', locked: false },
    ] });
    expect(start.status, JSON.stringify(start.json)).toBe(200);
    const before = await readComposition(path);
    h.db.seed(`UPDATE household_ranking_preferences
      SET values_json = '{"version":1,"values":{"forbiddenIngredientIds":["TOFU"]}}'
      WHERE household_id = '${HOUSE}'`);
    const cucumber = before.composition.components[2];
    const reordered = await h.call(HOUSE, 'PATCH', `${path}/components/${cucumber.id}`,
      { revision: before.planRevision, ordinal: 1 });
    expect(reordered.status, JSON.stringify(reordered.json)).toBe(200);
    expect(SlotCompositionDtoSchema.parse(reordered.json).composition.components.map((item) => item.id)).toEqual([
      before.composition.components[0].id, cucumber.id, before.composition.components[1].id,
    ]);
  }, CASE_TIMEOUT);

  it('hard max time: a dish over (or without) a known total time is rejected; the existing V1 anchor may stay', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    preferences({ hardMaxTimeMinutes: 5 });
    const manual = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' });
    expect(manual.json.code).toBe('HARD_CONSTRAINT_CONFLICT');
    // Locking an existing component adds nothing and is not re-judged.
    const lock = await h.call(HOUSE, 'PATCH', `${slotPath(plan.id, slotId)}/components/${encodeURIComponent(`v1.${slotId}`)}`,
      { revision: plan.revision, locked: true });
    expect(lock.status, JSON.stringify(lock.json)).toBe(200);
  }, CASE_TIMEOUT);
});

describe('T20 V1 family-variant meals', () => {
  function seedFamily() {
    h.db.seed(`INSERT INTO recipe_families (id, slug, name, base_servings, source_type, source_reference)
        VALUES ('${FAMILY_ID}', '${FAMILY_ID}', 'Gà xào', 2, 'curated', 'test:t20-family');
      INSERT INTO recipe_family_slots VALUES ('${FAMILY_ID}', 'protein', 1, 1);
      INSERT INTO recipe_family_options VALUES ('${FAMILY_ID}', 'protein', 'CHICKEN_BREAST', 300, 'g');
      UPDATE recipes SET family_id = '${FAMILY_ID}' WHERE id = '${FAMILY_HOST}';`);
  }
  function variantId() {
    const family = RecipeFamilySchema.parse({ id: FAMILY_ID, slug: FAMILY_ID, name: 'Gà xào', baseServings: 2,
      provenance: { sourceType: 'curated', version: 1, sourceReference: 'test:t20-family' },
      slots: [{ key: 'protein', minSelections: 1, maxSelections: 1, options: [{ ingredientId: 'CHICKEN_BREAST', quantity: 300, unit: 'g' }] }] });
    const catalog = createRecipeCatalog({ source: 'provided', ingredientIds: ['CHICKEN_BREAST'], recipes: [], families: [family] });
    return generateRecipeCandidates({ catalog, inventory: [], asOfDate: '2030-01-02', requestedServings: 2, mode: 'shopping_allowed' })
      .candidates[0].variant!.id;
  }

  it('keeps V1 swap, refuses composition, and stays in composed-plan shopping (single projection)', async () => {
    seedFamily();
    const plan = await generate();
    const [first, second] = plan.result.meals;
    const swapped = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/swap`,
      { revision: plan.revision, slotId: second.slotId, replacement: { kind: 'family', id: FAMILY_ID, variantId: variantId() } });
    expect(swapped.status, JSON.stringify(swapped.json)).toBe(200);
    const familyPlan = MealPlanDtoSchema.parse(swapped.json);
    expect(familyPlan.result.meals.find((meal) => meal.slotId === second.slotId)!.source.kind).toBe('family');

    const read = PlanCompositionsDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}/compositions`)).json);
    const familySlot = read.compositions.find((entry) => entry.slotId === second.slotId)!;
    expect(familySlot.source).toBe('v1_projection');
    expect(familySlot.warnings).toContain('LEGACY_FAMILY_MEAL');

    const path = slotPath(plan.id, second.slotId);
    for (const [method, suffix, body] of [
      ['POST', '/components', { revision: familyPlan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' }],
      ['POST', '/assist', { revision: familyPlan.revision, action: 'complete' }],
      ['POST', '/auto', { revision: familyPlan.revision }],
    ] as const) {
      const response = await h.call(HOUSE, method, `${path}${suffix}`, body);
      expect(response.status, `${suffix} ${JSON.stringify(response.json)}`).toBe(422);
      expect(response.json.code).toBe('LEGACY_FAMILY_COMPOSITION_UNSUPPORTED');
    }

    // Compose another slot so shopping takes the composition path; the family slot must still count.
    const add = await h.call(HOUSE, 'POST', `${slotPath(plan.id, first.slotId)}/components`,
      { revision: familyPlan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' });
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    const revision = SlotCompositionDtoSchema.parse(add.json).planRevision;
    const shopping = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/shopping`, { revision, currency: 'VND' });
    expect(shopping.status, JSON.stringify(shopping.json)).toBe(200);
    const chicken = PlanShoppingDtoSchema.parse(shopping.json).result.requirements.filter((item) => item.ingredientId === 'CHICKEN_BREAST');
    expect(chicken).toHaveLength(1);
    expect(chicken[0].sourceMealSlots.map((entry) => entry.slotId)).toContain(second.slotId);

    // V1 swap remains the edit path for the family slot.
    const back = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/swap`,
      { revision, slotId: second.slotId, replacement: { kind: 'recipe', id: second.source.id } });
    expect(back.status, JSON.stringify(back.json)).toBe(200);
  }, CASE_TIMEOUT * 2);
});
