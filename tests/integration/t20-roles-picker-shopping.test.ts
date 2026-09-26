import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MealPlanDtoSchema, PlanShoppingDtoSchema } from '../../packages/domain/src/meal-planning-api';
import { PICKER_CUISINES, PickerPageDtoSchema, SlotCompositionDtoSchema } from '../../packages/domain/src/meal-composition-api';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import { auditRoleDistribution, buildRoleIndex } from '../../packages/recipes/src/composition/roles';
import { resetRecipeAuthorityCacheForTests, resolveRecipeAuthority } from '../../src/worker/services/recipe-authority';
import { resetRoleIndexMemoForTests } from '../../src/worker/services/meal-composition';
import type { Env } from '../../src/worker/types';
import { quietLogs, T20Harness, T20_INTENT, T20_STOCK } from '../helpers/t20-composition-harness';

vi.mock('../../src/worker/services/email', () => ({ sendEmail: vi.fn(), buildOtpEmail: vi.fn() }));

const HOUSE = 't20-picker-a';
const STATIC_IDS = new Set(ALL_RECIPES.map((recipe) => recipe.id));
const CASE_TIMEOUT = 30_000;
let h: T20Harness;

beforeEach(async () => {
  h = new T20Harness();
  resetRecipeAuthorityCacheForTests();
  resetRoleIndexMemoForTests();
  quietLogs();
});
afterEach(() => {
  h.close();
  vi.restoreAllMocks();
});

describe('T20 role enrichment over the 500-recipe D1 release', () => {
  it('every recipe has ≥1 valid role; no duplicates or contradictions; the distribution is pinned', async () => {
    const resolution = await resolveRecipeAuthority({ DB: h.db, RECIPE_CATALOG_MODE: 'd1', RECIPE_CATALOG_CUTOVER_ENABLED: 'true' } as unknown as Env,
      { tenantKey: HOUSE });
    expect(resolution.snapshot.source).toBe('d1');
    expect(resolution.snapshot.size).toBe(500);
    const audit = auditRoleDistribution(buildRoleIndex(resolution.snapshot.list()));
    expect(audit.recipeCount).toBe(500);
    expect(audit.unclassified).toEqual([]);
    expect(audit.invalidRoles).toEqual([]);
    expect(audit.duplicateAssignments).toEqual([]);
    expect(audit.contradictions).toEqual([]);
    // Pinned so any rule change is a reviewed, visible diff (ROLE_RULES_VERSION).
    expect(audit.byRole).toMatchInlineSnapshot(`
      {
        "dessert": 0,
        "main": 362,
        "side": 87,
        "simple_food": 7,
        "soup": 70,
        "staple": 0,
        "vegetable": 37,
      }
    `);
    expect(audit.reviewRequired.length).toMatchInlineSnapshot(`0`);
    for (const role of ['main', 'side', 'vegetable', 'soup'] as const) expect(audit.byRole[role]).toBeGreaterThan(20);
    expect(audit.reviewRequired.length).toBeLessThan(25);
  });

  it('persisted reviewed rows override rules for the D1 authority only (fenced to the visible universe)', async () => {
    await h.seedHousehold(HOUSE);
    const recipeId = 'imp-26a36c69306143bc';
    h.db.seed(`INSERT INTO recipe_role_assignments (recipe_id, role, source, decision, confidence, reviewed) VALUES
      ('${recipeId}', 'side', 'reviewed', 'assign', NULL, 1)`);
    const d1 = PickerPageDtoSchema.parse((await h.call(HOUSE, 'GET', '/meal-planning/compositions/picker?role=side&kind=recipe&limit=24&q=bong%20cai')).json);
    expect(d1.items.find((item) => item.id === recipeId)?.roles).toEqual(['side']);
    // Constraint: fabricated confidence for a non-AI source is rejected by the schema.
    expect(() => h.db.seed(`INSERT INTO recipe_role_assignments (recipe_id, role, source, confidence, reviewed) VALUES ('${recipeId}', 'main', 'rule', 0.9, 0)`)).toThrow();
    expect(() => h.db.seed(`INSERT INTO recipe_role_assignments (recipe_id, role, source, decision, reviewed) VALUES ('${recipeId}', 'main', 'rule', 'reject', 0)`)).toThrow();
    expect(() => h.db.seed(`INSERT INTO recipe_role_assignments (recipe_id, role, source, reviewed) VALUES ('${recipeId}', 'main', 'reviewed', 0)`)).toThrow();
  }, CASE_TIMEOUT);
});

describe('T20 picker at 500 recipes', () => {
  it('pages through a bounded, stable, role-filtered, authority-fenced summary list with bounded queries', async () => {
    await h.seedHousehold(HOUSE);
    let statements = 0;
    h.db.hooks.beforeStatement = () => { statements++; };
    h.db.hooks.beforeBatch = (batch) => { statements += batch.length; };
    const first = await h.call(HOUSE, 'GET', '/meal-planning/compositions/picker?role=main&limit=24');
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const page = PickerPageDtoSchema.parse(first.json);
    const perRequest = statements;
    // Session + authority readiness/catalog + ranking context + one role read; never per-recipe reads.
    expect(perRequest).toBeLessThan(40);
    expect(page.items).toHaveLength(24);
    expect(page.total).toBeGreaterThan(200);
    expect(page.items.every((item) => item.roles.includes('main'))).toBe(true);
    expect(JSON.stringify(page)).not.toMatch(/instruction|steps|ingredients/);
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      statements = 0;
      const dto = PickerPageDtoSchema.parse((await h.call(HOUSE, 'GET',
        `/meal-planning/compositions/picker?role=main&limit=24${cursor ? `&cursor=${cursor}` : ''}`)).json);
      expect(statements).toBe(perRequest);
      for (const item of dto.items) { expect(seen.has(`${item.kind}:${item.id}`)).toBe(false); seen.add(`${item.kind}:${item.id}`); }
      cursor = dto.nextCursor;
      pages++;
    } while (cursor && pages < 40);
    expect(seen.size).toBe(page.total);
    const search = PickerPageDtoSchema.parse((await h.call(HOUSE, 'GET', `/meal-planning/compositions/picker?q=${encodeURIComponent('Canh')}`)).json);
    expect(search.items.length).toBeGreaterThan(0);
    expect(search.items.every((item) => item.title.toLowerCase().includes('canh'))).toBe(true);
    const foods = PickerPageDtoSchema.parse((await h.call(HOUSE, 'GET', '/meal-planning/compositions/picker?kind=simple_food&role=staple')).json);
    expect(foods.items.map((item) => item.id).sort()).toEqual(['sf-bread', 'sf-steamed-rice']);

    h.mode = 'static';
    const staticIds: string[] = [];
    cursor = null;
    do {
      const dto = PickerPageDtoSchema.parse((await h.call(HOUSE, 'GET',
        `/meal-planning/compositions/picker?kind=recipe&limit=24${cursor ? `&cursor=${cursor}` : ''}`)).json);
      staticIds.push(...dto.items.map((item) => item.id));
      cursor = dto.nextCursor;
    } while (cursor);
    expect(staticIds).toHaveLength(71);
    expect(staticIds.every((id) => STATIC_IDS.has(id))).toBe(true);
  }, CASE_TIMEOUT * 2);

  it('rejects malformed picker queries', async () => {
    await h.seedHousehold(HOUSE);
    for (const query of ['role=dessertx', 'limit=0', 'limit=500', 'cursor=-1', 'role=main&role=side', 'unknown=1', 'kind=family',
      'cuisine=french', 'cuisine=Korean', 'cuisine=korean&cuisine=thai']) {
      expect((await h.call(HOUSE, 'GET', `/meal-planning/compositions/picker?${query}`)).status, query).toBe(422);
    }
  }, CASE_TIMEOUT);

  it('cuisine filter uses catalog metadata, combines with role and search, excludes simple foods and is deterministic', async () => {
    await h.seedHousehold(HOUSE);
    const page = async (query: string) => {
      const response = await h.call(HOUSE, 'GET', `/meal-planning/compositions/picker?${query}`);
      expect(response.status, `${query} ${JSON.stringify(response.json)}`).toBe(200);
      return PickerPageDtoSchema.parse(response.json);
    };
    expect(ALL_RECIPES.every((recipe) => (PICKER_CUISINES as readonly string[]).includes(recipe.cuisine))).toBe(true);
    const korean = await page('cuisine=korean&limit=50');
    expect(korean.total).toBeGreaterThan(0);
    expect(korean.items.every((item) => item.kind === 'recipe' && item.cuisine === 'korean')).toBe(true);
    expect(await page('cuisine=korean&limit=50')).toEqual(korean);

    const koreanMains = await page('cuisine=korean&role=main&limit=50');
    expect(koreanMains.total).toBeGreaterThan(0);
    expect(koreanMains.total).toBeLessThanOrEqual(korean.total);
    expect(koreanMains.items.every((item) => item.cuisine === 'korean' && item.roles.includes('main'))).toBe(true);

    const target = korean.items[0];
    const q = encodeURIComponent(target.title);
    expect((await page(`cuisine=korean&q=${q}`)).items.map((item) => item.id)).toContain(target.id);
    expect((await page(`cuisine=japanese&q=${q}`)).items.map((item) => item.id)).not.toContain(target.id);
    expect((await page(`q=${q}`)).items.map((item) => item.id)).toContain(target.id);

    // Staples such as steamed rice have no cuisine metadata and are never inferred into a cuisine.
    expect((await page('role=staple&cuisine=vietnamese')).items.some((item) => item.kind === 'simple_food')).toBe(false);
    expect((await page('role=staple')).items.some((item) => item.kind === 'simple_food')).toBe(true);
    expect((await page('cuisine=korean&kind=simple_food')).total).toBe(0);
  }, CASE_TIMEOUT);
});

describe('T20 shopping on composed plans (HTTP)', () => {
  const requirementsFor = (json: unknown, ingredientId: string) =>
    PlanShoppingDtoSchema.parse(json).result.requirements.filter((item) => item.ingredientId === ingredientId);

  it('adds every component demand across meals and subtracts inventory once through the existing T05 path', async () => {
    // No rice in stock: the simple-food staples must appear as ONE aggregated shopping requirement.
    await h.seedHousehold(HOUSE, T20_STOCK.filter(([id]) => id !== 'RICE'));
    const planResponse = await h.call(HOUSE, 'POST', '/meal-planning/plans', T20_INTENT);
    expect(planResponse.status, JSON.stringify(planResponse.json)).toBe(200);
    const plan = MealPlanDtoSchema.parse(planResponse.json);
    const v1 = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/shopping`, { revision: plan.revision, currency: 'VND' });
    expect(v1.status, JSON.stringify(v1.json)).toBe(200);
    const v1Rice = requirementsFor(v1.json, 'RICE');
    let revision = plan.revision;
    for (const meal of plan.result.meals.slice(0, 2)) {
      const add = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/slots/${encodeURIComponent(meal.slotId)}/components`,
        { revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' });
      expect(add.status, JSON.stringify(add.json)).toBe(200);
      revision = SlotCompositionDtoSchema.parse(add.json).planRevision;
    }
    const composed = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/shopping`, { revision, currency: 'VND' });
    expect(composed.status, JSON.stringify(composed.json)).toBe(200);
    const rice = requirementsFor(composed.json, 'RICE');
    expect(rice).toHaveLength(1);
    const v1Known = v1Rice.length ? Number(v1Rice[0].knownRequired.value) : 0;
    // 2 meals × 2 servings × 80 g, on top of whatever V1 anchors already needed.
    expect(Number(rice[0].knownRequired.value)).toBe(v1Known + 320);
    expect(rice[0].sourceMealSlots.map((entry) => entry.slotId).sort()).toEqual(
      expect.arrayContaining(plan.result.meals.slice(0, 2).map((meal) => meal.slotId).sort()));
    // Shopping never mutates inventory.
    expect(h.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM inventory_items WHERE household_id = '${HOUSE}'`)[0].n)
      .toBe(T20_STOCK.length - 1);
    expect(h.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM inventory_events WHERE household_id = '${HOUSE}'`)[0].n).toBe(0);
  }, CASE_TIMEOUT);

  it('with the V2 flag off, a composed plan falls back to the exact V1 shopping projection', async () => {
    await h.seedHousehold(HOUSE, T20_STOCK.filter(([id]) => id !== 'RICE'));
    const plan = MealPlanDtoSchema.parse((await h.call(HOUSE, 'POST', '/meal-planning/plans', T20_INTENT)).json);
    const baseline = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/shopping`, { revision: plan.revision, currency: 'VND' });
    const add = SlotCompositionDtoSchema.parse((await h.call(HOUSE, 'POST',
      `/meal-planning/plans/${plan.id}/slots/${encodeURIComponent(plan.result.meals[0].slotId)}/components`,
      { revision: plan.revision, target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple' })).json);
    const off = await h.call(HOUSE, 'POST', `/meal-planning/plans/${plan.id}/shopping`, { revision: add.planRevision, currency: 'VND' },
      { MEAL_COMPOSITION_V2_ENABLED: undefined });
    expect(off.status).toBe(200);
    expect(PlanShoppingDtoSchema.parse(off.json).result.requirements).toEqual(PlanShoppingDtoSchema.parse(baseline.json).result.requirements);
  }, CASE_TIMEOUT);
});
