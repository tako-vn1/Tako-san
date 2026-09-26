import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanDtoSchema, PlanShoppingDtoSchema } from '../../packages/domain/src/meal-planning-api';
import {
  AssistProposalDtoSchema,
  AutoOptionsDtoSchema,
  SlotCompositionDtoSchema,
} from '../../packages/domain/src/meal-composition-api';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import { resetRecipeAuthorityCacheForTests } from '../../src/worker/services/recipe-authority';
import { resetRoleIndexMemoForTests } from '../../src/worker/services/meal-composition';
import { quietLogs, T20Harness, T20_INTENT } from '../helpers/t20-composition-harness';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));

const HOUSE = 't20-flow-a';
const OTHER = 't20-flow-b';
const STATIC_IDS = new Set(ALL_RECIPES.map((recipe) => recipe.id));
const D1_ONLY = 'imp-26a36c69306143bc';
const CASE_TIMEOUT = 30_000;

let h: T20Harness;
let events: Array<Record<string, unknown>>;

async function generate(house = HOUSE, intent: unknown = T20_INTENT) {
  const response = await h.call(house, 'POST', '/meal-planning/plans', intent);
  expect(response.status, JSON.stringify(response.json)).toBe(200);
  return MealPlanDtoSchema.parse(response.json);
}
const slotPath = (planId: string, slotId: string) => `/meal-planning/plans/${planId}/slots/${encodeURIComponent(slotId)}`;
const composition = async (planId: string, slotId: string) =>
  SlotCompositionDtoSchema.parse((await h.call(HOUSE, 'GET', `${slotPath(planId, slotId)}/composition`)).json);

beforeEach(async () => {
  h = new T20Harness();
  await h.seedHousehold(HOUSE);
  await h.seedHousehold(OTHER);
  resetRecipeAuthorityCacheForTests();
  resetRoleIndexMemoForTests();
  events = quietLogs();
});
afterEach(() => {
  h.close();
  vi.restoreAllMocks();
});

describe('T20 assisted composition', () => {
  it('"complete" proposes without mutating, retains every existing component, and applies only on explicit accept', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const response = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/assist`, { revision: plan.revision, action: 'complete' });
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const option = AssistProposalDtoSchema.parse(response.json).proposal!;
    expect(option).not.toBeNull();
    expect(option.removedComponentIds).toEqual([]);
    expect(option.components.filter((item) => item.existingComponentId !== null).map((item) => item.existingComponentId))
      .toEqual([`v1.${slotId}`]);
    expect(option.components.some((item) => item.role === 'staple')).toBe(true);
    expect(option.explanations.some((entry) => entry.code === 'ROLE_ADDED')).toBe(true);
    // A suggestion is not a mutation.
    expect(MealPlanDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}`)).json).revision).toBe(plan.revision);

    const apply = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/assist/apply`,
      { revision: plan.revision, action: 'complete', proposalId: option.optionId });
    expect(apply.status, JSON.stringify(apply.json)).toBe(200);
    const applied = SlotCompositionDtoSchema.parse(apply.json);
    expect(applied.composition.mode).toBe('assisted');
    expect(applied.composition.components[0].id).toBe(`v1.${slotId}`);
    expect(applied.composition.components.slice(1).every((item) => item.provenance === 'assisted' && !item.locked)).toBe(true);
    expect(applied.composition.missingRoles).toEqual([]);
    expect(events.some((event) => event.event === 'composition_assisted_update')).toBe(true);
  }, CASE_TIMEOUT);

  it('a forged or stale proposal ID is rejected and nothing changes', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const forged = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/assist/apply`,
      { revision: plan.revision, action: 'complete', proposalId: 'f'.repeat(32) });
    expect(forged.status).toBe(409);
    expect(forged.json.code).toBe('PROPOSAL_STALE');
    expect(MealPlanDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}`)).json).revision).toBe(plan.revision);
    expect(events.some((event) => event.event === 'composition_generation_failed' && event.failure_code === 'PROPOSAL_STALE')).toBe(true);
  }, CASE_TIMEOUT);
});

describe('T20 auto composition', () => {
  it('keeps locked components identical, replaces only unlocked ones, is deterministic and explainable', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const setupResponse = await h.call(HOUSE, 'PUT', `${slotPath(plan.id, slotId)}/composition`, {
      revision: plan.revision,
      components: [
        { target: { kind: 'recipe', recipeId: D1_ONLY }, role: 'main', locked: true },
        { target: { kind: 'simple_food', simpleFoodId: 'sf-boiled-egg' }, role: 'side', locked: false },
      ],
    });
    expect(setupResponse.status, JSON.stringify(setupResponse.json)).toBe(200);
    const setup = SlotCompositionDtoSchema.parse(setupResponse.json);
    const lockedBefore = setup.composition.components[0];
    const response = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`, { revision: setup.planRevision });
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const auto = AutoOptionsDtoSchema.parse(response.json);
    expect(auto.options.length).toBeGreaterThan(0);
    expect(auto.budget.exhausted).toBe(false);
    for (const option of auto.options) {
      expect(option.removedComponentIds).toEqual([setup.composition.components[1].id]);
      expect(option.components.find((item) => item.existingComponentId === lockedBefore.id)).toMatchObject({ locked: true, recipeId: D1_ONLY });
      expect(option.components.filter((item) => item.role === 'main')).toHaveLength(1);
      expect(option.components.some((item) => item.role === 'staple')).toBe(true);
    }
    const again = AutoOptionsDtoSchema.parse((await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`, { revision: setup.planRevision })).json);
    expect(again.options).toEqual(auto.options);
    const variant = AutoOptionsDtoSchema.parse((await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`,
      { revision: setup.planRevision, variant: 3 })).json);
    expect(variant.variant).toBe(3);

    const apply = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto/apply`,
      { revision: setup.planRevision, optionId: auto.options[0].optionId });
    expect(apply.status, JSON.stringify(apply.json)).toBe(200);
    const applied = SlotCompositionDtoSchema.parse(apply.json);
    const after = applied.composition.components.find((item) => item.id === lockedBefore.id)!;
    expect({ ...after, ordinal: 0, projection: null }).toEqual({ ...lockedBefore, ordinal: 0, projection: null });
    expect(applied.composition.components.some((item) => item.id === setup.composition.components[1].id)).toBe(false);
    expect(applied.composition.mode).toBe('auto');
    expect(events.some((event) => event.event === 'composition_auto_generated')).toBe(true);
  }, CASE_TIMEOUT);

  it('respects household hard restrictions in Auto and rejects them in Manual', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    h.db.seed(`INSERT INTO household_ranking_preferences (household_id, values_json, updated_at)
      VALUES ('${HOUSE}', '{"version":1,"values":{"forbiddenIngredientIds":["RICE","CHICKEN_EGG"]}}', '2029-01-01T00:00:00.000Z')`);
    const response = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`, { revision: plan.revision });
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    for (const option of AutoOptionsDtoSchema.parse(response.json).options) {
      for (const item of option.components.filter((entry) => entry.existingComponentId === null)) {
        expect(['sf-steamed-rice', 'sf-boiled-egg']).not.toContain(item.simpleFoodId);
      }
    }
    const manual = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' });
    expect(manual.status).toBe(422);
    expect(manual.json.code).toBe('HARD_CONSTRAINT_CONFLICT');
  }, CASE_TIMEOUT);
});

describe('T20 optimistic concurrency and idempotency', () => {
  it('competing add/add and swap/swap: exactly one wins, the stale one is a typed conflict', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const add = (id: string, role: string) => h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: id }, role });
    const adds = await Promise.all([add('sf-steamed-rice', 'staple'), add('sf-sliced-cucumber', 'vegetable')]);
    expect(adds.map((entry) => entry.status).sort()).toEqual([200, 409]);
    expect(adds.map((entry) => entry.json.code)).toContain('PLAN_REVISION_CONFLICT');
    const current = await composition(plan.id, slotId);
    expect(current.composition.components).toHaveLength(2);
    expect(current.planRevision).toBe(plan.revision + 1);

    const main = current.composition.components[0].id;
    const swap = (recipeId: string) => h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components/${encodeURIComponent(main)}/swap`,
      { revision: current.planRevision, target: { kind: 'recipe', recipeId } });
    const swaps = await Promise.all([swap(D1_ONLY), swap('vn-kho-02')]);
    expect(swaps.map((entry) => entry.status).sort()).toEqual([200, 409]);
  }, CASE_TIMEOUT);

  it('competing add/remove, lock/regenerate and manual-save/auto-apply never lose the winner or apply the loser', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const addRemove = await Promise.all([
      h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
        { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' }),
      h.call(HOUSE, 'DELETE', `${slotPath(plan.id, slotId)}/components/${encodeURIComponent(`v1.${slotId}`)}?revision=${plan.revision}`),
    ]);
    expect(addRemove.map((entry) => entry.status).sort()).toEqual([200, 409]);

    const latest = await composition(plan.id, slotId);
    const target = latest.composition.components[0].id;
    const race = await Promise.all([
      h.call(HOUSE, 'PATCH', `${slotPath(plan.id, slotId)}/components/${encodeURIComponent(target)}`, { revision: latest.planRevision, locked: false }),
      h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/regenerate`, { revision: latest.planRevision }),
    ]);
    expect(race.map((entry) => entry.status).sort()).toEqual([200, 409]);

    const now = await composition(plan.id, slotId);
    const auto = AutoOptionsDtoSchema.parse((await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`, { revision: now.planRevision })).json);
    expect(auto.options.length).toBeGreaterThan(0);
    const saveVsAuto = await Promise.all([
      h.call(HOUSE, 'PUT', `${slotPath(plan.id, slotId)}/composition`, { revision: now.planRevision, components: [] }),
      h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto/apply`, { revision: now.planRevision, optionId: auto.options[0].optionId }),
    ]);
    expect(saveVsAuto.map((entry) => entry.status).sort()).toEqual([200, 409]);
    const final = await composition(plan.id, slotId);
    expect(final.planRevision).toBe(now.planRevision + 1);
  }, CASE_TIMEOUT * 2);

  it('a retried add (same revision) never duplicates a component', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const body = { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' };
    expect((await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`, body)).status).toBe(200);
    expect((await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`, body)).status).toBe(409);
    const current = await composition(plan.id, slotId);
    expect(current.composition.components.filter((item) => item.simpleFoodId === 'sf-steamed-rice')).toHaveLength(1);
    const duplicate = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`, { ...body, revision: current.planRevision });
    expect(duplicate.status).toBe(422);
    expect(duplicate.json.code).toBe('DUPLICATE_COMPONENT');
    expect(h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM generated_meal_plan_components')[0].n).toBe(2);
  }, CASE_TIMEOUT);
});

describe('T20 security', () => {
  it('cross-household plan/component access fails without leaking existence or writing', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const cases: Array<[string, string, unknown]> = [
      ['GET', `/meal-planning/plans/${plan.id}/compositions`, undefined],
      ['GET', `${slotPath(plan.id, slotId)}/composition`, undefined],
      ['POST', `${slotPath(plan.id, slotId)}/components`, { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-bread' }, role: 'staple' }],
      ['POST', `${slotPath(plan.id, slotId)}/auto`, { revision: plan.revision }],
      ['POST', `${slotPath(plan.id, slotId)}/assist`, { revision: plan.revision, action: 'complete' }],
      ['DELETE', `${slotPath(plan.id, slotId)}/components/${encodeURIComponent(`v1.${slotId}`)}?revision=${plan.revision}`, undefined],
    ];
    for (const [method, path, body] of cases) {
      expect((await h.call(OTHER, method, path, body)).status, `${method} ${path}`).toBe(404);
    }
    expect(h.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM generated_meal_plan_compositions')[0].n).toBe(0);
  }, CASE_TIMEOUT);

  it('clients cannot inject authority, household, provenance, role source, confidence, inventory, prices, weights or lock bypass', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const base = { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' };
    for (const extra of [{ recipeAuthority: 'static' }, { catalogSource: 'd1' }, { householdId: OTHER }, { provenance: 'legacy_v1' },
      { roleSource: 'reviewed' }, { confidence: 1 }, { inventory: [] }, { price: 1 }, { weights: { roleCompleteness: 1 } }]) {
      expect((await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`, { ...base, ...extra })).status,
        JSON.stringify(extra)).toBe(422);
    }
    const header = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`, base, {},
      { 'X-Recipe-Authority': 'static', 'X-Household-Id': OTHER });
    expect(header.status).toBe(200);
    const wrongRole = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision + 1, target: { kind: 'simple_food', simpleFoodId: 'sf-bread' }, role: 'soup' });
    expect(wrongRole.status).toBe(422);
    expect(wrongRole.json.code).toBe('ROLE_NOT_PERMITTED');
    const bypass = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto/apply`,
      { revision: plan.revision + 1, optionId: '0'.repeat(32), removeLocked: true });
    expect(bypass.status).toBe(422);
    const unknownSlot = await h.call(HOUSE, 'GET', `${slotPath(plan.id, '2031-01-01:dinner:0')}/composition`);
    expect(unknownSlot.status).toBe(404);
    expect((await h.call(HOUSE, 'GET', `${slotPath(plan.id, 'not-a-slot')}/composition`)).status).toBe(422);
  }, CASE_TIMEOUT);
});

describe('T20 × T19 recipe authority', () => {
  it('d1: a D1-only recipe added to a meal resolves in Recipe API detail, cooking and shopping', async () => {
    const plan = await generate();
    const slotId = plan.result.meals.find((meal) => meal.source.id !== D1_ONLY)!.slotId;
    const add = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'recipe', recipeId: D1_ONLY }, role: 'main' });
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    const component = SlotCompositionDtoSchema.parse(add.json).composition.components.find((item) => item.recipeId === D1_ONLY)!;
    expect(component.cookable).toBe(true);
    expect((await h.call(HOUSE, 'GET', `/recipes/${D1_ONLY}`)).status).toBe(200);
    expect((await h.call(HOUSE, 'POST', `/recipes/${D1_ONLY}/cook/start`)).status).toBe(200);
    const shopping = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/shopping`, { revision: plan.revision + 1, currency: 'VND' });
    expect(shopping.status, JSON.stringify(shopping.json)).toBe(200);
    PlanShoppingDtoSchema.parse(shopping.json);
  }, CASE_TIMEOUT);

  it('static: a D1-only recipe is TARGET_NOT_FOUND exactly as the Recipe API 404s it, and Auto proposes only static recipes', async () => {
    h.mode = 'static';
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const add = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'recipe', recipeId: D1_ONLY }, role: 'main' });
    expect(add.status).toBe(422);
    expect(add.json.code).toBe('TARGET_NOT_FOUND');
    expect((await h.call(HOUSE, 'GET', `/recipes/${D1_ONLY}`)).status).toBe(404);
    const auto = AutoOptionsDtoSchema.parse((await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`, { revision: plan.revision })).json);
    for (const option of auto.options) {
      for (const item of option.components) if (item.recipeId) expect(STATIC_IDS.has(item.recipeId), item.recipeId).toBe(true);
    }
  }, CASE_TIMEOUT);

  it('an invisible D1-only edit does not stale a static plan (historical T19 stale-plan regression)', async () => {
    h.mode = 'static';
    const plan = await generate();
    h.db.seed(`UPDATE recipes SET title = title || ' (edited)' WHERE id = '${D1_ONLY}'`);
    const reread = MealPlanDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}`)).json);
    expect(reread.freshness.reasons).not.toContain('stale_catalog');
    const slotId = plan.result.meals[0].slotId;
    const add = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' });
    expect(add.status, JSON.stringify(add.json)).toBe(200);
  }, CASE_TIMEOUT);

  it('an authority source change is a typed revalidation for composition edits and generation', async () => {
    h.mode = 'static';
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    h.mode = 'd1';
    const add = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' });
    expect(add.status).toBe(409);
    expect(add.json.code).toBe('CATALOG_AUTHORITY_CHANGED');
    const auto = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/auto`, { revision: plan.revision });
    expect(auto.status).toBe(409);
    expect(auto.json.code).toBe('CATALOG_AUTHORITY_CHANGED');
  }, CASE_TIMEOUT);
});

describe('T20 V1 operations on composed plans', () => {
  it('V1 swap on a composed slot is a typed 409; regenerate preserves locked components and replaces unlocked ones', async () => {
    const plan = await generate();
    const [first, second] = plan.result.meals;
    const composedResponse = await h.call(HOUSE, 'PUT', `${slotPath(plan.id, first.slotId)}/composition`, {
      revision: plan.revision,
      components: [
        { id: `v1.${first.slotId}`, target: { kind: 'recipe', recipeId: first.source.id }, role: 'main', locked: true },
        { target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple', locked: true },
        { target: { kind: 'simple_food', simpleFoodId: 'sf-sliced-cucumber' }, role: 'vegetable', locked: false },
      ],
    });
    expect(composedResponse.status, JSON.stringify(composedResponse.json)).toBe(200);
    const composed = SlotCompositionDtoSchema.parse(composedResponse.json);
    const swap = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/swap`,
      { revision: composed.planRevision, slotId: first.slotId, replacement: { kind: 'recipe', id: D1_ONLY } });
    expect(swap.status).toBe(409);
    expect(swap.json.code).toBe('COMPOSITION_MANAGED_SLOT');
    const otherSwap = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/swap`,
      { revision: composed.planRevision, slotId: second.slotId, replacement: { kind: 'recipe', id: D1_ONLY } });
    expect(otherSwap.status, JSON.stringify(otherSwap.json)).toBe(200);
    const afterSwap = MealPlanDtoSchema.parse(otherSwap.json);

    const regenerated = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/regenerate`, { revision: afterSwap.revision });
    expect(regenerated.status, JSON.stringify(regenerated.json)).toBe(200);
    const plan2 = MealPlanDtoSchema.parse(regenerated.json);
    expect(plan2.result.meals.find((meal) => meal.slotId === first.slotId)!.source.id).toBe(first.source.id);
    const after = await composition(plan.id, first.slotId);
    expect(after.planRevision).toBe(plan2.revision);
    expect(after.composition.components.map((item) => [item.id, item.role, item.locked])).toEqual([
      [`v1.${first.slotId}`, 'main', true], [composed.composition.components[1].id, 'staple', true]]);
  }, CASE_TIMEOUT * 2);
});
