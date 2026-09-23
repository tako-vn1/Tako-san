import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT,
  STATIC_MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT,
  loadMealPlanningSnapshot,
} from '../../packages/db/src/meal-planning-snapshot';
import { ALL_RECIPES } from '../../packages/recipes/src/data';
import {
  createRecipeAuthoritySnapshot,
  currentCatalogRelease,
} from '../../packages/recipes/src/recipe-authority';
import { readRecipeContent } from '../../packages/db/src/recipe-content';
import { hydrateRuntimeRecipes } from '../../packages/recipes/src/runtime-hydration';
import type { Recipe } from '../../packages/recipes/src/types';
import { MealPlanningApplicationService } from '../../src/worker/services/meal-planning';
import { MealPlanningError } from '../../src/worker/services/meal-planning-error';
import { SqliteD1 } from '../helpers/sqlite-d1';

/**
 * T19 — planner snapshot fingerprints and stored-plan authority identity.
 * The catalog fingerprint must depend only on the recipe universe visible under the EFFECTIVE
 * authority, and a persisted plan must carry the authority it was planned under so an authority
 * change is a typed revalidation, never a silent re-plan.
 */
const HOUSEHOLD = 't19-persist-home';
const USER = 't19-persist-user';
const NOW = '2029-12-31T00:00:00.000Z';
const release = currentCatalogRelease();
const STATIC_IDS = new Set(ALL_RECIPES.map((recipe) => recipe.id));
const D1_ONLY = release.orderedRecipeIds.find((id) => !STATIC_IDS.has(id))!;

let db: SqliteD1;
const scope = { householdId: HOUSEHOLD, userId: USER };
const staticAuthority = () => createRecipeAuthoritySnapshot('static', ALL_RECIPES);
const d1Authority = async () =>
  createRecipeAuthoritySnapshot(
    'd1',
    hydrateRuntimeRecipes(await readRecipeContent(db)).recipes as Recipe[],
  );

beforeEach(() => {
  db = new SqliteD1();
  db.seed(`INSERT INTO users (id) VALUES ('${USER}');
    INSERT INTO households (id, name, created_by) VALUES ('${HOUSEHOLD}', 'T19', '${USER}');
    INSERT INTO household_members (id, household_id, user_id, role) VALUES ('hm', '${HOUSEHOLD}', '${USER}', 'owner');
    INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit, category, storage, freshness, version) VALUES
      ('eggs', '${HOUSEHOLD}', 'CHICKEN_EGG', 'Trứng', 30, 'piece', 'egg', 'fridge', 'fresh', 1),
      ('tomato', '${HOUSEHOLD}', 'TOMATO', 'Cà chua', 20, 'piece', 'vegetable', 'fridge', 'fresh', 1),
      ('shrimp', '${HOUSEHOLD}', 'SHRIMP', 'Tôm', 1000, 'g', 'seafood', 'fridge', 'fresh', 1);`);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('authority-aware planner snapshot', () => {
  it('static authority: universe = 71 legacy recipes, source static, steps/nutrition fenced to the universe', async () => {
    const snapshot = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
    expect(snapshot.catalog.source).toBe('static');
    expect(snapshot.catalog.recipes.map((recipe) => recipe.id).sort()).toEqual(
      [...STATIC_IDS].sort(),
    );
    expect(snapshot.catalog.recipes.some((recipe) => recipe.id === D1_ONLY)).toBe(false);
    expect(snapshot.recipeSteps.every((step) => STATIC_IDS.has(step.recipeId))).toBe(true);
    expect(snapshot.recipeSteps.length).toBe(
      ALL_RECIPES.reduce((total, recipe) => total + recipe.steps.length, 0),
    );
    expect(snapshot.authority).toEqual({
      source: 'static',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      recipeCount: 71,
    });
    expect(snapshot.visibleRecipeIds.size).toBe(71);
    // Static content is the Recipe API content: exactly ALL_RECIPES' ingredient lines, not D1 rows.
    const canh = snapshot.catalog.recipes.find((recipe) => recipe.id === 'vn-canh-01')!;
    expect(canh.ingredients.map((line) => line.ingredientId)).toEqual(
      ALL_RECIPES.find((recipe) => recipe.id === 'vn-canh-01')!.ingredients.map(
        (line) => line.ingredientId,
      ),
    );
  });

  it('d1 authority: universe = the verified 500-recipe release with rich D1 facts (classifications, provenance)', async () => {
    db.seed(`INSERT INTO ingredients (id, name_vi, name_en, category) VALUES ('T19_D1_HIDDEN_ONLY', 'Ẩn D1', 'D1 hidden', 'other');
      INSERT INTO recipe_families (id, slug, name, base_servings) VALUES ('t19-d1-unlinked-family', 't19-d1-unlinked-family', 'D1 unlinked family', 2);
      INSERT INTO recipe_family_slots (family_id, slot_key, min_selections, max_selections) VALUES ('t19-d1-unlinked-family', 'base', 1, 1);
      INSERT INTO recipe_family_options (family_id, slot_key, ingredient_id, quantity, unit) VALUES ('t19-d1-unlinked-family', 'base', 'T19_D1_HIDDEN_ONLY', 100, 'g')`);
    const snapshot = await loadMealPlanningSnapshot(db, scope, NOW, await d1Authority());
    expect(snapshot.catalog.source).toBe('d1');
    expect(snapshot.catalog.recipes).toHaveLength(release.expectedRecipeCount);
    expect(
      snapshot.catalog.classifications.some(
        (fact) => fact.recipeId === D1_ONLY && fact.kind === 'meal_type',
      ),
    ).toBe(true);
    expect(
      snapshot.catalog.recipes.find((recipe) => recipe.id === D1_ONLY)!.provenance.sourceType,
    ).toBe('ai_generated');
    expect(snapshot.catalog.families).not.toContainEqual(
      expect.objectContaining({ id: 't19-d1-unlinked-family' }),
    );
    expect(snapshot.catalog.ingredientIds).not.toContain('T19_D1_HIDDEN_ONLY');
    expect(snapshot.authority).toMatchObject({
      source: 'd1',
      recipeCount: release.expectedRecipeCount,
    });
  });

  it.each(['static', 'shadow', 'canary-outside'] as const)(
    '%s planning is invariant to visible and invisible D1 catalog mutations',
    async () => {
      const before = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
      db.seed(`UPDATE recipes SET title = title || ' (edited)' WHERE id = '${D1_ONLY}';
      UPDATE recipe_steps SET instruction = instruction || '!' WHERE recipe_id = '${D1_ONLY}';
      UPDATE nutrition_profiles SET protein_g = COALESCE(protein_g, 0) + 1;
      INSERT INTO ingredients (id, name_vi, name_en, category) VALUES ('T19_HIDDEN_ONLY', 'Ẩn', 'Hidden', 'other');
      INSERT INTO recipe_families (id, slug, name, base_servings) VALUES ('t19-hidden-family', 't19-hidden-family', 'Hidden family', 2);
      INSERT INTO recipe_family_slots (family_id, slot_key, min_selections, max_selections) VALUES ('t19-hidden-family', 'base', 1, 1);
      INSERT INTO recipe_family_options (family_id, slot_key, ingredient_id, quantity, unit) VALUES ('t19-hidden-family', 'base', 'RICE', 100, 'g')`);
      const batches: Array<Array<{ sql: string }>> = [];
      db.hooks.beforeBatch = (statements) => {
        batches.push([...statements]);
      };
      const hiddenChange = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
      expect(hiddenChange.fingerprint).toEqual(before.fingerprint);
      expect(hiddenChange.catalog).toEqual(before.catalog);
      expect(hiddenChange.recipeSteps).toEqual(before.recipeSteps);
      expect(hiddenChange.catalog.ingredientIds).not.toContain('T19_HIDDEN_ONLY');
      expect(hiddenChange.catalog.families).not.toContainEqual(
        expect.objectContaining({ id: 't19-hidden-family' }),
      );
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(STATIC_MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT);
      expect(
        batches[0].some((statement) =>
          /FROM (?:ingredients|recipe_ingredients|recipe_families|recipe_family_|nutrition_profiles|recipe_steps)\b|recipe_classifications\b/i.test(
            statement.sql,
          ),
        ),
      ).toBe(false);

      db.seed(
        "UPDATE recipes SET family_id = 't19-hidden-family' WHERE id = 'vn-canh-01'; INSERT INTO recipe_classifications (recipe_id, kind, tag) VALUES ('vn-canh-01', 'allergen', 'shellfish')",
      );
      const visibleChange = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());
      expect(visibleChange.fingerprint).toEqual(before.fingerprint);
      expect(visibleChange.catalog).toEqual(before.catalog);
    },
  );

  it('static authority performs no optional D1 planner reads', async () => {
    const batches: Array<Array<{ sql: string }>> = [];
    db.hooks.beforeBatch = (statements) => {
      batches.push([...statements]);
      if (
        statements.some((statement) =>
          /FROM (?:ingredients|recipe_ingredients|recipe_families|recipe_family_|nutrition_profiles|recipe_steps)\b|recipe_classifications\b/i.test(
            statement.sql,
          ),
        )
      )
        throw new Error('Unexpected optional D1 planner read');
    };

    const snapshot = await loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority());

    expect(snapshot.catalog.source).toBe('static');
    expect(snapshot.catalog.recipes.map((recipe) => recipe.id).sort()).toEqual(
      [...STATIC_IDS].sort(),
    );
    expect(snapshot.catalog.families).toEqual([]);
    expect(snapshot.catalog.classifications).toEqual([]);
    expect(batches.map((batch) => batch.length)).toEqual([
      STATIC_MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT,
    ]);
  });

  it('D1 planner enrichment failure keeps the resolved D1 universe and still plans', async () => {
    const authority = await d1Authority();
    const batches: Array<Array<{ sql: string }>> = [];
    db.hooks.beforeBatch = (statements) => {
      batches.push([...statements]);
      if (
        statements.some((statement) =>
          /FROM (?:ingredients|recipe_ingredients|recipe_families|recipe_family_|nutrition_profiles|recipe_steps)\b|recipe_classifications\b/i.test(
            statement.sql,
          ),
        )
      )
        throw new Error('D1 planner enrichment unavailable');
    };

    const snapshot = await loadMealPlanningSnapshot(db, scope, NOW, authority);
    expect(snapshot.catalog.source).toBe('d1');
    expect(snapshot.catalog.recipes.map((recipe) => recipe.id)).toEqual(
      authority
        .list()
        .map((recipe) => recipe.id)
        .sort(),
    );
    expect(snapshot.catalog.recipes.find((recipe) => recipe.id === D1_ONLY)?.title).toBe(
      authority.findById(D1_ONLY)?.title,
    );
    expect(snapshot.catalog.families).toEqual([]);
    expect(snapshot.catalog.classifications).toEqual([]);
    expect(snapshot.catalog.diagnostics).toEqual([]);
    expect(snapshot.recipeSteps.map((step) => step.recipeId)).toEqual(
      authority.list().flatMap((recipe) => recipe.steps.map(() => recipe.id)),
    );
    expect(batches.map((batch) => batch.length)).toEqual([
      MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT,
      STATIC_MEAL_PLANNING_SNAPSHOT_STATEMENT_COUNT,
    ]);

    const generated = await new MealPlanningApplicationService(db, {
      now: () => new Date(NOW),
      recipeAuthority: async () => authority,
    }).generate(
      scope,
      {
        startDate: '2030-01-02',
        horizonDays: 1,
        utcOffsetMinutes: 0,
        defaultServings: 2,
        mode: 'shopping_allowed',
        slots: [{ date: '2030-01-02', mealType: 'dinner', sequence: 0 }],
      },
      't19-d1-enrichment-fallback',
    );
    expect(generated.result).toBeDefined();
  });

  it('d1 catalog fingerprint tracks D1-visible changes', async () => {
    const before = await loadMealPlanningSnapshot(db, scope, NOW, await d1Authority());
    db.seed(
      `UPDATE recipe_steps SET instruction = instruction || '!' WHERE recipe_id = '${D1_ONLY}'`,
    );
    const after = await loadMealPlanningSnapshot(db, scope, NOW, await d1Authority());
    expect(after.fingerprint.parts.catalog).not.toBe(before.fingerprint.parts.catalog);
  });

  it('d1 planner content comes from the resolved authority snapshot, not a later raw D1 read', async () => {
    const authority = await d1Authority();
    const expected = authority.findById(D1_ONLY)!;
    db.seed(`UPDATE recipes SET title = title || ' (raced)' WHERE id = '${D1_ONLY}';
      UPDATE recipe_steps SET instruction = instruction || ' raced' WHERE recipe_id = '${D1_ONLY}'`);

    const snapshot = await loadMealPlanningSnapshot(db, scope, NOW, authority);

    expect(snapshot.catalog.recipes.find((recipe) => recipe.id === D1_ONLY)!.title).toBe(
      expected.title,
    );
    expect(
      snapshot.recipeSteps
        .filter((step) => step.recipeId === D1_ONLY)
        .map((step) => step.instruction),
    ).toEqual(expected.steps.map((step) => step.instruction));
  });

  it('static and d1 authorities yield different planner catalog fingerprints for the same database', async () => {
    const [s, d] = await Promise.all([
      loadMealPlanningSnapshot(db, scope, NOW, await staticAuthority()),
      loadMealPlanningSnapshot(db, scope, NOW, await d1Authority()),
    ]);
    expect(s.fingerprint.parts.catalog).not.toBe(d.fingerprint.parts.catalog);
    expect(s.fingerprint.parts.inventory).toBe(d.fingerprint.parts.inventory);
  });
});

describe('stored plan authority identity', () => {
  const intent = {
    startDate: '2030-01-02',
    horizonDays: 2,
    utcOffsetMinutes: 0,
    defaultServings: 2,
    mode: 'shopping_allowed' as const,
    slots: [
      { date: '2030-01-02', mealType: 'dinner' as const, sequence: 0 },
      { date: '2030-01-03', mealType: 'dinner' as const, sequence: 0 },
    ],
  };
  const service = (authority: () => Promise<Awaited<ReturnType<typeof staticAuthority>>>) =>
    new MealPlanningApplicationService(db, {
      now: () => new Date(NOW),
      recipeAuthority: authority,
    });

  it('persists the authority source/fingerprint/count with the plan and stays fresh under the same authority', async () => {
    const plan = await service(staticAuthority).generate(scope, intent, 'persist-key-0001');
    const stored = JSON.parse(
      db.query<{ source_json: string }>('SELECT source_json FROM generated_meal_plans')[0]
        .source_json,
    );
    expect(stored.version).toBe(1);
    expect(stored.data.authority).toEqual({
      source: 'static',
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      recipeCount: 71,
    });
    expect(Object.keys(stored.data).sort()).toEqual([
      'authority',
      'catalog',
      'history',
      'inventory',
      'preferences',
    ]);
    expect(plan.freshness.status).toBe('fresh');
    expect((await service(staticAuthority).get(scope, plan.id)).freshness.status).toBe('fresh');
  });

  it('an authority change is a typed revalidation: freshness names it, swap and shopping refuse, regenerate recovers', async () => {
    const plan = await service(staticAuthority).generate(scope, intent, 'persist-key-0002');
    const underD1 = service(d1Authority);
    const reread = await underD1.get(scope, plan.id);
    expect(reread.freshness.status).toBe('requires_revalidation');
    expect(reread.freshness.reasons).toContain('catalog_authority_changed');
    expect(reread.result).toEqual(plan.result); // historical plan data is untouched
    await expect(
      underD1.swap(scope, plan.id, {
        revision: 1,
        slotId: plan.result.meals[0].slotId,
        replacement: { kind: 'recipe', id: D1_ONLY },
      }),
    ).rejects.toMatchObject({
      code: 'CATALOG_AUTHORITY_CHANGED',
      status: 409,
    } satisfies Partial<MealPlanningError>);
    await expect(
      underD1.shopping(scope, plan.id, { revision: 1, currency: 'VND' }),
    ).rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_CHANGED', status: 409 });
    expect(
      db.query<{ revision: number }>('SELECT revision FROM generated_meal_plans')[0].revision,
    ).toBe(1);
    const regenerated = await underD1.regenerate(scope, plan.id, { revision: 1 });
    expect(regenerated.revision).toBe(2);
    expect(regenerated.freshness.status).toBe('fresh');
    expect(
      JSON.parse(
        db.query<{ source_json: string }>('SELECT source_json FROM generated_meal_plans')[0]
          .source_json,
      ).data.authority.source,
    ).toBe('d1');
  });

  it('same-source authority fingerprint drift is typed even when the planner catalog fingerprint is unchanged', async () => {
    const plan = await service(staticAuthority).generate(scope, intent, 'persist-key-same-source');
    const changedStaticAuthority = () =>
      createRecipeAuthoritySnapshot(
        'static',
        ALL_RECIPES.map((recipe, index) =>
          index === 0 ? { ...recipe, tags: [...recipe.tags, 't19-authority-change'] } : recipe,
        ),
      );
    const changed = service(changedStaticAuthority);
    const reread = await changed.get(scope, plan.id);
    expect(reread.freshness.reasons).toContain('catalog_authority_changed');
    expect(reread.freshness.reasons).not.toContain('stale_catalog');
    await expect(
      changed.swap(scope, plan.id, {
        revision: 1,
        slotId: plan.result.meals[0].slotId,
        replacement: { kind: 'recipe', id: 'vn-canh-01' },
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_CHANGED', status: 409 });
    await expect(
      changed.shopping(scope, plan.id, { revision: 1, currency: 'VND' }),
    ).rejects.toMatchObject({ code: 'CATALOG_AUTHORITY_CHANGED', status: 409 });
  });

  it('a lock on a recipe that is no longer visible is dropped on regenerate, never silently substituted in place', async () => {
    const underD1 = service(d1Authority);
    const plan = await underD1.generate(scope, intent, 'persist-key-0003');
    const swapped = await underD1.swap(scope, plan.id, {
      revision: 1,
      slotId: plan.result.meals[0].slotId,
      replacement: { kind: 'recipe', id: 'imp-26a36c69306143bc' },
    });
    expect(swapped.result.meals[0].source.id).toBe('imp-26a36c69306143bc');
    // Rollback to static: the D1-only lock cannot be honored.
    const underStatic = service(staticAuthority);
    const regenerated = await underStatic.regenerate(scope, plan.id, {
      revision: swapped.revision,
    });
    expect(regenerated.result.meals.every((meal) => STATIC_IDS.has(meal.source.id))).toBe(true);
    expect(
      JSON.parse(
        db.query<{ intent_json: string }>('SELECT intent_json FROM generated_meal_plans')[0]
          .intent_json,
      ).data.locks,
    ).toEqual([]);
  });

  it('static plans stay fresh when D1-only planner metadata changes', async () => {
    const planner = service(staticAuthority);
    const plan = await planner.generate(scope, intent, 'persist-key-stale-swap');
    db.seed(
      "INSERT INTO recipe_classifications (recipe_id, kind, tag) VALUES ('vn-canh-01', 'allergen', 't19-stale-swap')",
    );

    const current = await planner.get(scope, plan.id);
    expect(current.freshness.status).toBe('fresh');
    expect(current.freshness.reasons).not.toContain('stale_catalog');
  });

  it('regenerate drops family locks whose planner provenance version is stale', async () => {
    db.seed(`INSERT INTO recipe_families (id, slug, name, base_servings)
        VALUES ('t19-versioned-family', 't19-versioned-family', 'Versioned family', 2);
      INSERT INTO recipe_family_slots (family_id, slot_key, min_selections, max_selections)
        VALUES ('t19-versioned-family', 'base', 1, 1);
      INSERT INTO recipe_family_options (family_id, slot_key, ingredient_id, quantity, unit)
        VALUES ('t19-versioned-family', 'base', 'RICE', 100, 'g');
      UPDATE recipes SET family_id = 't19-versioned-family' WHERE id = 'vn-canh-01'`);
    const planner = service(d1Authority);
    const plan = await planner.generate(scope, intent, 'persist-key-family-version');
    const swapped = await planner.swap(scope, plan.id, {
      revision: plan.revision,
      slotId: plan.result.meals[0].slotId,
      replacement: {
        kind: 'family',
        id: 't19-versioned-family',
        variantId: 'family:t19-versioned-family:v1:[["RICE","g",100,null]]',
      },
    });
    expect(swapped.result.meals[0].source).toMatchObject({
      kind: 'family',
      id: 't19-versioned-family',
      version: 1,
    });
    db.seed("UPDATE recipe_families SET version = 2 WHERE id = 't19-versioned-family'");

    await planner.regenerate(scope, plan.id, { revision: swapped.revision });

    expect(
      JSON.parse(
        db.query<{ intent_json: string }>('SELECT intent_json FROM generated_meal_plans')[0]
          .intent_json,
      ).data.locks,
    ).toEqual([]);
  });

  it('plans persisted before T19 (no authority identity) still decode and revalidate through the catalog fingerprint', async () => {
    const plan = await service(staticAuthority).generate(scope, intent, 'persist-key-0004');
    db.seed(
      `UPDATE generated_meal_plans SET source_json = json_remove(source_json, '$.data.authority') WHERE id = '${plan.id}'`,
    );
    const legacy = await service(d1Authority).get(scope, plan.id);
    expect(legacy.freshness.reasons).toContain('stale_catalog');
    expect(legacy.freshness.reasons).not.toContain('catalog_authority_changed');
    await expect(
      service(d1Authority).swap(scope, plan.id, {
        revision: 1,
        slotId: plan.result.meals[0].slotId,
        replacement: { kind: 'recipe', id: D1_ONLY },
      }),
    ).rejects.toMatchObject({ code: 'PLAN_REVALIDATION_REQUIRED', status: 409 });
  });

  it('resolves the recipe authority once for each planner mutation', async () => {
    let resolutions = 0;
    const authority = async () => {
      resolutions += 1;
      return staticAuthority();
    };
    const planner = service(authority);
    const plan = await planner.generate(scope, intent, 'persist-key-resolution-count');
    expect(resolutions).toBe(1);

    const swapped = await planner.swap(scope, plan.id, {
      revision: plan.revision,
      slotId: plan.result.meals[0].slotId,
      replacement: { kind: 'recipe', id: 'vn-canh-01' },
    });
    expect(resolutions).toBe(2);

    await planner.regenerate(scope, plan.id, { revision: swapped.revision });
    expect(resolutions).toBe(3);
  });
});
