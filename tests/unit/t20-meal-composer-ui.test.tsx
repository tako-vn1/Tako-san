// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanDtoSchema, type MealPlanDto } from '../../packages/domain/src/meal-planning-api';
import { PlanCompositionsDtoSchema, type PlanCompositionsDto } from '../../packages/domain/src/meal-composition-api';

const api = vi.hoisted(() => ({
  plan: vi.fn(), add: vi.fn(), swap: vi.fn(), update: vi.fn(), remove: vi.fn(), assist: vi.fn(), assistApply: vi.fn(),
  auto: vi.fn(), autoApply: vi.fn(), picker: vi.fn(), get: vi.fn(),
}));
vi.mock('../../src/web/services/meal-composition', () => ({ mealCompositionApi: api }));
vi.mock('../../src/web/services/meal-planning', () => ({ mealPlanningApi: { get: api.get } }));

import { MealComposer } from '../../src/web/features/planner/MealComposer';
import { PlannerMeal } from '../../src/web/features/planner/PlannerMeal';
import { PlannerWeek } from '../../src/web/features/planner/PlannerWeek';

const planId = '5b7c8f1e-2a3d-4c5b-8e9f-0a1b2c3d4e5f';
const date = '2030-01-07';
const slotId = `${date}:dinner:0`;
const instant = `${date}T18:00:00.000Z`;

const RECIPE_SOURCE = { kind: 'recipe', id: 'pho-bo', version: 1, variantId: null };
const FAMILY_SOURCE = { kind: 'family', id: 'stir-fry', version: 3, variantId: 'family:stir-fry:v3:[]' };

function plan(revision = 4, source: Record<string, unknown> = RECIPE_SOURCE): MealPlanDto {
  return MealPlanDtoSchema.parse({
    schemaVersion: 1, id: planId, householdId: 'house-ui', revision, createdAt: instant, updatedAt: instant,
    intent: { startDate: date, horizonDays: 1, utcOffsetMinutes: 0, defaultServings: 2, mode: 'shopping_allowed', slots: [{ date, mealType: 'dinner' }] },
    result: { status: 'feasible', conclusion: 'feasible', planningReference: { instant, localDate: date, utcOffsetMinutes: 0 },
      meals: [{ slotId, date, mealType: 'dinner', time: '18:00', instant, servings: 2, candidateId: 'c',
        source, title: 'Phở bò', cuisine: null, prepTimeMinutes: null,
        cookTimeMinutes: 40, instructions: [], requirements: [], reasons: [], safetyAssessment: 'not_requested', projectedConsumption: [] }],
      unplannedSlots: [], search: { exhaustive: true, plannerExhaustive: true, recipeExhaustive: true, truncated: false, limitReasons: [],
        incompleteReasons: [], rejections: [] }, diagnostics: [] },
    freshness: { status: 'fresh', reasons: [], checkedAt: instant, requiresRevalidationBeforeConsumption: true },
  });
}

function compositions(revision = 4): PlanCompositionsDto {
  const component = (id: string, title: string, role: string, extra: Record<string, unknown>) => ({ id, title, role, ordinal: 0, locked: false,
    provenance: 'manual', recipeId: null, simpleFoodId: null, permittedRoles: [role], cookable: false, resolvable: true, cookTimeMinutes: 10,
    createdRevision: 1, updatedRevision: 1, projection: { status: 'covered', missingCount: 0, inventoryLineCount: 1 }, ...extra });
  return PlanCompositionsDtoSchema.parse({ schemaVersion: 1, planId, planRevision: revision, compositions: [{
    slotId, date, mealType: 'dinner', servings: 2, source: 'v2', mode: 'manual', missingRoles: [], recommendedRoles: ['soup'], warnings: [],
    components: [
      component('v1.x', 'Phở bò', 'main', { kind: 'recipe', recipeId: 'pho-bo', provenance: 'legacy_v1', permittedRoles: ['main'], cookable: true }),
      component('c-rice', 'Cơm trắng', 'staple', { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice', ordinal: 1, locked: true,
        permittedRoles: ['staple', 'simple_food'] }),
    ] }] });
}

function model(current: MealPlanDto) {
  return {
    query: {} as never, plan: current, busy: null, error: null, refreshed: false, replacePlan: vi.fn(), requestKey: vi.fn(),
    retireRequestKey: vi.fn(),
    perform: vi.fn(async (_label: string, operation: () => Promise<unknown>, accept?: (value: unknown) => void) => {
      const result = await operation(); accept?.(result); return result;
    }),
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_MEAL_COMPOSITION_V2_ENABLED', 'true');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.plan.mockResolvedValue(compositions());
  api.get.mockResolvedValue(plan(5));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>));
  await settle();
}
async function settle(ms = 0) {
  for (let index = 0; index < 5; index++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
const byLabel = (label: string) => [...document.querySelectorAll<HTMLElement>('button, select, input, a')]
  .find((element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === label)!;

describe('T20 Meal composer UI', () => {
  it('renders components with accessible role labels and lock state; lock is a server mutation at the current revision', async () => {
    const current = plan();
    const m = model(current);
    api.update.mockResolvedValue({});
    await render(<MealComposer plan={current} slotId={slotId} model={m as never} locale="en" />);
    expect(container.textContent).toContain('Phở bò');
    expect(container.textContent).toContain('Steamed rice');
    expect(container.textContent).toContain('Staple');
    const lockRice = byLabel('Unlock dish: Steamed rice');
    expect(lockRice.getAttribute('aria-pressed')).toBe('true');
    expect(byLabel('Lock dish: Phở bò').getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('This meal has no soup component. Add one?');
    await act(async () => byLabel('Lock dish: Phở bò').click());
    expect(api.update).toHaveBeenCalledWith(planId, slotId, 'v1.x', { revision: 4, locked: true });
    // The authoritative plan is reloaded after the revision moves.
    expect(api.get).toHaveBeenCalledWith(planId);
    expect(m.replacePlan).toHaveBeenCalled();
    expect(container.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  it('picker is a focus-managed dialog; Escape cancels without any mutation', async () => {
    const current = plan();
    api.picker.mockResolvedValue({ schemaVersion: 1, items: [{ kind: 'simple_food', id: 'sf-sliced-cucumber', title: 'Dưa leo thái lát',
      roles: ['vegetable', 'side', 'simple_food'], cuisine: null, cookTimeMinutes: 5, difficulty: null, constraintState: 'none_requested' }],
    nextCursor: null, total: 1 });
    await render(<MealComposer plan={current} slotId={slotId} model={model(current) as never} locale="en" />);
    await act(async () => byLabel('Add dish').click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.getAttribute('type')).toBe('search');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(api.picker).toHaveBeenCalled();
    expect(dialog.textContent).toContain('Sliced cucumber');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(api.add).not.toHaveBeenCalled();
  });

  it('choosing in the picker adds a locked component at the current revision', async () => {
    const current = plan();
    api.picker.mockResolvedValue({ schemaVersion: 1, items: [{ kind: 'recipe', id: 'canh-chua', title: 'Canh chua',
      roles: ['soup'], cuisine: 'vietnamese', cookTimeMinutes: 30, difficulty: 'easy', constraintState: 'none_requested' }], nextCursor: null, total: 1 });
    api.add.mockResolvedValue({});
    await render(<MealComposer plan={current} slotId={slotId} model={model(current) as never} locale="en" />);
    await act(async () => byLabel('Add dish').click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    await act(async () => byLabel('Choose: Canh chua').click());
    expect(api.add).toHaveBeenCalledWith(planId, slotId, { revision: 4, target: { kind: 'recipe', recipeId: 'canh-chua' }, role: 'soup', locked: true });
  });

  it('"Complete this meal" shows an explicit suggestion; nothing changes until Accept', async () => {
    const current = plan();
    api.assist.mockResolvedValue({ schemaVersion: 1, planId, planRevision: 4, slotId, action: 'complete', variant: 0,
      budget: { anchorsConsidered: 0, candidatesConsidered: 6, partialsExplored: 6, scoringOperations: 6, exhausted: false },
      proposal: { optionId: 'a'.repeat(32), removedComponentIds: [], unfilledRoles: [],
        score: { total: 0.8, parts: { roleCompleteness: 1, inventoryCoverage: 1, shoppingCostProxy: 1, ingredientReuse: 0, preferenceFit: 0.5, variety: 1, effort: 1 } },
        explanations: [{ code: 'USES_INVENTORY', count: 3, role: null }, { code: 'ROLE_ADDED', count: null, role: 'soup' }],
        components: [{ kind: 'recipe', role: 'soup', recipeId: 'canh-chua', simpleFoodId: null, title: 'Canh chua', locked: false, existingComponentId: null }] } });
    api.assistApply.mockResolvedValue({});
    await render(<MealComposer plan={current} slotId={slotId} model={model(current) as never} locale="en" />);
    await act(async () => byLabel('Complete this meal').click());
    expect(container.textContent).toContain('Uses 3 ingredients already in your fridge.');
    expect(container.textContent).toContain('Soup added for meal balance.');
    expect(api.assistApply).not.toHaveBeenCalled();
    await act(async () => byLabel('Use this suggestion').click());
    expect(api.assistApply).toHaveBeenCalledWith(planId, slotId, { revision: 4, action: 'complete', variant: 0, proposalId: 'a'.repeat(32) });
  });

  it('week cards render multi-component compositions with role chips (progressive disclosure)', async () => {
    const current = plan();
    await render(<PlannerWeek plan={current} model={model(current) as never} locale="vi" />);
    const list = container.querySelector('ul[aria-label="Các món trong bữa"]')!;
    expect(list.textContent).toContain('Phở bò');
    expect(list.textContent).toContain('Cơm / tinh bột');
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });
});

describe('T20 meal page keeps V1 controls where the composer cannot act', () => {
  const composerVisible = () => container.textContent!.includes('Complete this meal');
  const swapVisible = () => [...container.querySelectorAll('button')].some((button) => button.textContent?.includes('Swap meal'));
  function v1Projection(source: 'v1_projection' | 'v2' = 'v1_projection', warnings: string[] = []) {
    const base = compositions();
    return PlanCompositionsDtoSchema.parse({ ...base, compositions: [{ ...base.compositions[0], source,
      mode: source === 'v2' ? 'manual' : null, components: [], missingRoles: ['main'], warnings }] });
  }

  it('flag on, recipe slot: the composer replaces the V1 swap', async () => {
    const current = plan();
    await render(<PlannerMeal plan={current} slotId={slotId} model={model(current) as never} locale="en" />);
    expect(composerVisible()).toBe(true);
    expect(swapVisible()).toBe(false);
  });

  it('flag on, V1 family-variant slot: V1 swap stays and no composer is offered', async () => {
    api.plan.mockResolvedValue(v1Projection('v1_projection', ['LEGACY_FAMILY_MEAL']));
    const current = plan(4, FAMILY_SOURCE);
    await render(<PlannerMeal plan={current} slotId={slotId} model={model(current) as never} locale="en" />);
    expect(api.plan).toHaveBeenCalled();
    expect(swapVisible()).toBe(true);
    expect(composerVisible()).toBe(false);
  });

  it('mismatch — UI flag on, server flag off (compositions 404): V1 swap stays, no composer', async () => {
    const { ApiError } = await import('../../src/web/services/http');
    api.plan.mockRejectedValue(new ApiError('http', 'Not found', 404));
    const current = plan();
    await render(<PlannerMeal plan={current} slotId={slotId} model={model(current) as never} locale="en" />);
    expect(swapVisible()).toBe(true);
    expect(composerVisible()).toBe(false);
  });

  it('flag off build: pre-T20 page, the composition API is never called', async () => {
    vi.stubEnv('VITE_MEAL_COMPOSITION_V2_ENABLED', 'false');
    const current = plan();
    await render(<PlannerMeal plan={current} slotId={slotId} model={model(current) as never} locale="en" />);
    expect(api.plan).not.toHaveBeenCalled();
    expect(swapVisible()).toBe(true);
    expect(composerVisible()).toBe(false);
  });
});
