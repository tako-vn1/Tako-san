import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanDtoSchema } from '../../packages/domain/src/meal-planning-api';
import { AutoOptionsDtoSchema, SlotCompositionDtoSchema } from '../../packages/domain/src/meal-composition-api';
import { resetRoleIndexMemoForTests } from '../../src/worker/services/meal-composition';
import { resetRecipeAuthorityCacheForTests } from '../../src/worker/services/recipe-authority';
import { T20Harness, T20_INTENT } from '../helpers/t20-composition-harness';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));

const HOUSE = 't20-stale-read';
const TIMEOUT = 40_000;
type Response = Awaited<ReturnType<T20Harness['call']>>;
let h: T20Harness;

const slotPath = (planId: string, slotId: string) => `/meal-planning/plans/${planId}/slots/${encodeURIComponent(slotId)}`;
const composition = async (planId: string, slotId: string) =>
  SlotCompositionDtoSchema.parse((await h.call(HOUSE, 'GET', `${slotPath(planId, slotId)}/composition`)).json);

async function plan() {
  const result = await h.call(HOUSE, 'POST', '/meal-planning/plans', T20_INTENT);
  expect(result.status, JSON.stringify(result.json)).toBe(200);
  return MealPlanDtoSchema.parse(result.json);
}

async function addRice(planId: string, slotId: string, revision: number) {
  const result = await h.call(HOUSE, 'POST', `${slotPath(planId, slotId)}/components`, {
    revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple',
  });
  expect(result.status, JSON.stringify(result.json)).toBe(200);
  return SlotCompositionDtoSchema.parse(result.json);
}

async function raceAfterPlanRead(planId: string, slotId: string, revision: number,
  stale: () => Promise<Response>, winner: () => Promise<Response>) {
  let reached!: () => void;
  let release!: () => void;
  const atRead = new Promise<void>((resolve) => { reached = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  let armed = true;
  h.db.hooks.afterStatement = async ({ method, sql }) => {
    if (!armed || method !== 'all' || !sql.includes('SELECT plan.*') || !sql.includes('FROM generated_meal_plans plan')) return;
    armed = false;
    reached();
    await held;
  };
  const losingRequest = stale();
  try {
    await atRead;
    const winningResponse = await winner();
    expect(winningResponse.status, JSON.stringify(winningResponse.json)).toBe(200);
    const winningState = await composition(planId, slotId);
    expect(winningState.planRevision).toBe(revision + 1);
    release();
    const losingResponse = await losingRequest;
    expect(losingResponse.status, JSON.stringify(losingResponse.json)).toBe(409);
    expect(losingResponse.json.code).toBe('PLAN_REVISION_CONFLICT');
    expect(await composition(planId, slotId)).toEqual(winningState);
    const persisted = MealPlanDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/plans/${planId}`)).json);
    expect(persisted.revision).toBe(revision + 1);
  } finally {
    release();
    h.db.hooks.afterStatement = undefined;
    await losingRequest.catch(() => {});
  }
}

beforeEach(async () => {
  h = new T20Harness();
  await h.seedHousehold(HOUSE);
  resetRecipeAuthorityCacheForTests();
  resetRoleIndexMemoForTests();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { h.close(); vi.restoreAllMocks(); });

describe('T20 torn-read revision classification', () => {
  it('stale PATCH after regenerate returns 409 even when the edited component was replaced', async () => {
    const created = await plan();
    const slotId = created.result.meals[0].slotId;
    const current = await addRice(created.id, slotId, created.revision);
    const legacyId = `v1.${slotId}`;
    await raceAfterPlanRead(created.id, slotId, current.planRevision,
      () => h.call(HOUSE, 'PATCH', `${slotPath(created.id, slotId)}/components/${encodeURIComponent(legacyId)}`,
        { revision: current.planRevision, locked: true }),
      () => h.call(HOUSE, 'POST', `/meal-planning/plans/${created.id}/regenerate`, { revision: current.planRevision }));
  }, TIMEOUT);

  it('stale DELETE after a concurrent DELETE does not erase the winner', async () => {
    const created = await plan();
    const slotId = created.result.meals[0].slotId;
    const current = await addRice(created.id, slotId, created.revision);
    const riceId = current.composition.components[1].id;
    const remove = () => h.call(HOUSE, 'DELETE', `${slotPath(created.id, slotId)}/components/${riceId}?revision=${current.planRevision}`);
    await raceAfterPlanRead(created.id, slotId, current.planRevision, remove, remove);
  }, TIMEOUT);

  it('stale swap after a concurrent removal returns a revision conflict, not component missing', async () => {
    const created = await plan();
    const slotId = created.result.meals[0].slotId;
    const current = await addRice(created.id, slotId, created.revision);
    const riceId = current.composition.components[1].id;
    await raceAfterPlanRead(created.id, slotId, current.planRevision,
      () => h.call(HOUSE, 'POST', `${slotPath(created.id, slotId)}/components/${riceId}/swap`,
        { revision: current.planRevision, target: { kind: 'simple_food', simpleFoodId: 'sf-bread' } }),
      () => h.call(HOUSE, 'DELETE', `${slotPath(created.id, slotId)}/components/${riceId}?revision=${current.planRevision}`));
  }, TIMEOUT);

  it('stale replace/save cannot overwrite the winning mutation', async () => {
    const created = await plan();
    const slotId = created.result.meals[0].slotId;
    const current = await addRice(created.id, slotId, created.revision);
    await raceAfterPlanRead(created.id, slotId, current.planRevision,
      () => h.call(HOUSE, 'PUT', `${slotPath(created.id, slotId)}/composition`, { revision: current.planRevision, components: [] }),
      () => h.call(HOUSE, 'DELETE', `${slotPath(created.id, slotId)}/components/${current.composition.components[1].id}?revision=${current.planRevision}`));
  }, TIMEOUT);

  it('stale Auto apply returns a revision conflict before checking its option ID', async () => {
    const created = await plan();
    const slotId = created.result.meals[0].slotId;
    const current = await addRice(created.id, slotId, created.revision);
    const optionsResponse = await h.call(HOUSE, 'POST', `${slotPath(created.id, slotId)}/auto`, { revision: current.planRevision });
    expect(optionsResponse.status).toBe(200);
    const options = AutoOptionsDtoSchema.parse(optionsResponse.json);
    expect(options.options.length).toBeGreaterThan(0);
    await raceAfterPlanRead(created.id, slotId, current.planRevision,
      () => h.call(HOUSE, 'POST', `${slotPath(created.id, slotId)}/auto/apply`,
        { revision: current.planRevision, optionId: options.options[0].optionId }),
      () => h.call(HOUSE, 'PUT', `${slotPath(created.id, slotId)}/composition`, { revision: current.planRevision, components: [] }));
  }, TIMEOUT);

  it('a genuinely absent component at the current revision stays 404; an absent slot stays SLOT_NOT_FOUND', async () => {
    const created = await plan();
    const slotId = created.result.meals[0].slotId;
    const missing = await h.call(HOUSE, 'PATCH', `${slotPath(created.id, slotId)}/components/not-a-component`,
      { revision: created.revision, locked: true });
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe('COMPONENT_NOT_FOUND');
    const slot = await h.call(HOUSE, 'PATCH', `${slotPath(created.id, '2030-02-01:dinner:0')}/components/not-a-component`,
      { revision: created.revision, locked: true });
    expect(slot.status).toBe(404);
    expect(slot.json.code).toBe('SLOT_NOT_FOUND');
    expect((await composition(created.id, slotId)).planRevision).toBe(created.revision);
  }, TIMEOUT);
});
