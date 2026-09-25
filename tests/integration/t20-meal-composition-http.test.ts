import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanDtoSchema, PlanShoppingDtoSchema } from '../../packages/domain/src/meal-planning-api';
import {
  AssistProposalDtoSchema,
  AutoOptionsDtoSchema,
  PickerPageDtoSchema,
  PlanCompositionsDtoSchema,
  SlotCompositionDtoSchema,
} from '../../packages/domain/src/meal-composition-api';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import { resetRecipeAuthorityCacheForTests } from '../../src/worker/services/recipe-authority';
import { resetRoleIndexMemoForTests } from '../../src/worker/services/meal-composition';
import { quietLogs, T20Harness, T20_INTENT } from '../helpers/t20-composition-harness';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));

const HOUSE = 't20-house-a';
const OTHER = 't20-house-b';
const STATIC_IDS = new Set(ALL_RECIPES.map((recipe) => recipe.id));
// D1-only pilot recipe (Tôm xào bông cải xanh), fully covered by the harness stock.
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

describe('T20 V1 compatibility', () => {
  it('a V1 one-recipe plan reads as a valid one-component composition without changing the V1 contract', async () => {
    const plan = await generate();
    const response = await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}/compositions`);
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    const dto = PlanCompositionsDtoSchema.parse(response.json);
    expect(dto.planRevision).toBe(plan.revision);
    for (const meal of plan.result.meals) {
      const composition = dto.compositions.find((entry) => entry.slotId === meal.slotId)!;
      expect(composition.source).toBe('v1_projection');
      expect(composition.components).toHaveLength(1);
      expect(composition.components[0]).toMatchObject({ kind: 'recipe', role: 'main', provenance: 'legacy_v1',
        recipeId: meal.source.id, id: `v1.${meal.slotId}`, cookable: true, resolvable: true });
    }
    // Reading compositions never mutates the V1 plan.
    const reread = MealPlanDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}`)).json);
    expect(reread.revision).toBe(plan.revision);
    expect(reread.result).toEqual(plan.result);
  }, CASE_TIMEOUT);

  it('composition routes are 404 while the V2 flag is off and V1 behaves unchanged', async () => {
    const plan = await generate();
    const off = { MEAL_COMPOSITION_V2_ENABLED: undefined };
    const read = await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}/compositions`, undefined, off);
    expect(read.status).toBe(404);
    expect(read.json.code).toBe('MEAL_COMPOSITION_DISABLED');
    const picker = await h.call(HOUSE, 'GET', '/meal-planning/compositions/picker', undefined, off);
    expect(picker.status).toBe(404);
    const add = await h.call(HOUSE, 'POST', `${slotPath(plan.id, plan.result.meals[0].slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' }, off);
    expect(add.status).toBe(404);
  }, CASE_TIMEOUT);
});

describe('T20 manual builder', () => {
  it('add / lock / swap / reorder / remove persist server-side with one shared revision', async () => {
    const plan = await generate();
    const slotId = plan.result.meals[0].slotId;
    const add = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' });
    expect(add.status, JSON.stringify(add.json)).toBe(200);
    const added = SlotCompositionDtoSchema.parse(add.json);
    expect(added.planRevision).toBe(plan.revision + 1);
    expect(added.composition.source).toBe('v2');
    expect(added.composition.components.map((item) => [item.role, item.provenance, item.locked])).toEqual([
      ['main', 'legacy_v1', false], ['staple', 'manual', true]]);
    const rice = added.composition.components[1];
    expect(rice.cookable).toBe(false);

    // V1 GET sees the same revision; the V1 generation record is untouched.
    const v1 = MealPlanDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${plan.id}`)).json);
    expect(v1.revision).toBe(plan.revision + 1);
    expect(v1.result).toEqual(plan.result);

    const lock = await h.call(HOUSE, 'PATCH', `${slotPath(plan.id, slotId)}/components/${encodeURIComponent(added.composition.components[0].id)}`,
      { revision: added.planRevision, locked: true });
    expect(lock.status, JSON.stringify(lock.json)).toBe(200);
    const locked = SlotCompositionDtoSchema.parse(lock.json);
    expect(locked.composition.components[0].locked).toBe(true);

    const swap = await h.call(HOUSE, 'POST', `${slotPath(plan.id, slotId)}/components/${encodeURIComponent(locked.composition.components[0].id)}/swap`,
      { revision: locked.planRevision, target: { kind: 'recipe', recipeId: D1_ONLY } });
    expect(swap.status, JSON.stringify(swap.json)).toBe(200);
    const swapped = SlotCompositionDtoSchema.parse(swap.json);
    expect(swapped.composition.components[0]).toMatchObject({ recipeId: D1_ONLY, provenance: 'manual', locked: true,
      id: locked.composition.components[0].id });

    const reorder = await h.call(HOUSE, 'PATCH', `${slotPath(plan.id, slotId)}/components/${rice.id}`,
      { revision: swapped.planRevision, ordinal: 0 });
    const reordered = SlotCompositionDtoSchema.parse(reorder.json);
    expect(reordered.composition.components.map((item) => item.role)).toEqual(['staple', 'main']);

    const remove = await h.call(HOUSE, 'DELETE', `${slotPath(plan.id, slotId)}/components/${rice.id}?revision=${reordered.planRevision}`);
    expect(remove.status, JSON.stringify(remove.json)).toBe(200);
    const removed = SlotCompositionDtoSchema.parse(remove.json);
    expect(removed.composition.components).toHaveLength(1);

    const reread = SlotCompositionDtoSchema.parse((await h.call(HOUSE, 'GET', `${slotPath(plan.id, slotId)}/composition`)).json);
    expect(reread).toEqual(removed);
    expect(events.filter((event) => event.event === 'composition_manual_update')).toHaveLength(5);
  }, CASE_TIMEOUT);
});
