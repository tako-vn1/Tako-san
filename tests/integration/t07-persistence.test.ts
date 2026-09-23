import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGeneratedMealPlan,
  getGeneratedMealPlan,
  updateGeneratedMealPlan,
} from '../../packages/db/src/meal-planning';
import {
  MealPlanningApplicationService,
  type MealPlanningServiceOptions,
} from '../../src/worker/services/meal-planning';
import * as weeklyPlanner from '../../packages/recipes/src/weekly-planner';
import { createBarrier, SqliteD1 } from '../helpers/sqlite-d1';
import { fixtureRecipeAuthority } from '../helpers/recipe-authority-fixtures';

const scope = { householdId: 't07-persistence-home', userId: 't07-persistence-user' };
const fingerprint = 'a'.repeat(64);
const mealPlanningNow = new Date('2030-01-01T00:00:00.000Z');
const mealPlanningIntent = {
  startDate: '2030-01-02', horizonDays: 2, utcOffsetMinutes: 0, defaultServings: 2, mode: 'shopping_allowed' as const,
  slots: [
    { date: '2030-01-02', mealType: 'dinner' as const, sequence: 0 },
    { date: '2030-01-03', mealType: 'dinner' as const, sequence: 0 },
  ],
};
const firstSlot = '2030-01-02:dinner:0';
const databases: SqliteD1[] = [];

function payload(data: Record<string, unknown>) {
  return JSON.stringify({ version: 1, data });
}

function persistedPayload(data: Record<string, unknown>) {
  return JSON.stringify({ data, version: 1 });
}

function fixture() {
  const db = new SqliteD1();
  db.seed(`
    INSERT INTO users (id) VALUES ('${scope.userId}');
    INSERT INTO households (id, name, created_by)
      VALUES ('${scope.householdId}', 'T07 persistence home', '${scope.userId}');
    INSERT INTO household_members (id, household_id, user_id, role)
      VALUES ('t07-persistence-member', '${scope.householdId}', '${scope.userId}', 'owner');
  `);
  return db;
}

function database() {
  const db = fixture();
  databases.push(db);
  return db;
}

function mealPlanningFixture() {
  const db = database();
  db.seed(`
    INSERT INTO users (id) VALUES ('t07-persistence-member');
    INSERT INTO household_members (id, household_id, user_id, role)
      VALUES ('t07-persistence-member-row', '${scope.householdId}', 't07-persistence-member', 'member');
    DELETE FROM recipes;
    INSERT INTO recipes (id, slug, title, cuisine, servings, prep_time_minutes, cook_time_minutes, difficulty)
      VALUES ('a-small', 't07-a-small', 'Small chicken meal', 'vietnamese', 2, 0, 10, 'easy'),
        ('z-large', 't07-z-large', 'Large chicken meal', 'vietnamese', 2, 0, 10, 'easy');
    INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, name, required_quantity, unit, is_optional)
      VALUES ('t07-line-small', 'a-small', 'CHICKEN_BREAST', 'Chicken', 100, 'g', 0),
        ('t07-line-large', 'z-large', 'CHICKEN_BREAST', 'Chicken', 400, 'g', 0);
    INSERT INTO recipe_steps (id, recipe_id, step_number, instruction)
      VALUES ('t07-step-small', 'a-small', 1, 'Cook thoroughly.');
    INSERT INTO inventory_items (id, household_id, ingredient_id, name, quantity, unit, version)
      VALUES ('t07-stock', '${scope.householdId}', 'CHICKEN_BREAST', 'Chicken', 500, 'g', 3);
  `);
  return db;
}

function service(db: SqliteD1, purchaseCatalog?: MealPlanningServiceOptions['purchaseCatalog']) {
  return new MealPlanningApplicationService(db, { now: () => mealPlanningNow, purchaseCatalog, recipeAuthority: fixtureRecipeAuthority(db) });
}

async function createPlan(db: SqliteD1) {
  await createGeneratedMealPlan(db, scope, {
    id: 't07-persistence-plan', requestKey: 't07-create', requestFingerprint: fingerprint,
    intentJson: payload({ operation: 'initial' }), resultJson: payload({ operation: 'initial' }),
    sourceJson: payload({ operation: 'initial' }),
  });
}

function updateInput(operation: string, expectedRevision: number) {
  return {
    id: 't07-persistence-plan', expectedRevision,
    intentJson: payload({ operation }), resultJson: payload({ operation }), sourceJson: payload({ operation }),
  };
}

async function generate(serviceInstance: MealPlanningApplicationService, key = 't07-generate') {
  return serviceInstance.generate(scope, mealPlanningIntent, key);
}

async function expectOneRevisionWinner(
  db: SqliteD1,
  left: () => Promise<unknown>,
  right: () => Promise<unknown>,
) {
  const barrier = createBarrier(2);
  db.hooks.beforeStatement = async (event) => {
    if (event.sql.trimStart().startsWith('UPDATE generated_meal_plans')) await barrier.wait();
  };
  const outcomes = await Promise.allSettled([left(), right()]);
  db.hooks.beforeStatement = undefined;
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes).toContainEqual(expect.objectContaining({
    status: 'rejected', reason: expect.objectContaining({ code: 'REVISION_CONFLICT' }),
  }));
}

afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.restoreAllMocks();
});

describe('T07 generated-plan persistence concurrency', () => {
  it('returns the row written by a successful CAS when a later revision commits before its response', async () => {
    const db = database();
    await createPlan(db);

    let blocked = false;
    let entered!: () => void;
    let release!: () => void;
    const firstUpdateWritten = new Promise<void>((resolve) => { entered = resolve; });
    const releaseFirstUpdate = new Promise<void>((resolve) => { release = resolve; });
    db.hooks.afterStatement = async (event) => {
      if (!blocked && event.sql.trimStart().startsWith('UPDATE generated_meal_plans')) {
        blocked = true;
        entered();
        await releaseFirstUpdate;
      }
    };

    const first = updateGeneratedMealPlan(db, scope, updateInput('first', 1));
    await firstUpdateWritten;
    const second = await updateGeneratedMealPlan(db, scope, updateInput('second', 2));
    release();

    await expect(first).resolves.toMatchObject({
      revision: 2,
      resultJson: persistedPayload({ operation: 'first' }),
    });
    expect(second).toMatchObject({
      revision: 3,
      resultJson: persistedPayload({ operation: 'second' }),
    });
  });

  it('allows only one same-revision swap winner and only one swap/regenerate winner', async () => {
    const db = mealPlanningFixture();
    const serviceInstance = service(db);
    const plan = await generate(serviceInstance);

    await expectOneRevisionWinner(db,
      () => serviceInstance.swap(scope, plan.id, {
        revision: 1, slotId: firstSlot, replacement: { kind: 'recipe', id: 'z-large' },
      }),
      () => serviceInstance.swap(scope, plan.id, {
        revision: 1, slotId: firstSlot, replacement: { kind: 'recipe', id: 'a-small' },
      }),
    );
    expect((await getGeneratedMealPlan(db, scope, plan.id)).revision).toBe(2);

    const secondPlan = await generate(serviceInstance, 't07-generate-second');
    await expectOneRevisionWinner(db,
      () => serviceInstance.swap(scope, secondPlan.id, {
        revision: 1, slotId: firstSlot, replacement: { kind: 'recipe', id: 'z-large' },
      }),
      () => serviceInstance.regenerate(scope, secondPlan.id, { revision: 1 }),
    );
    expect((await getGeneratedMealPlan(db, scope, secondPlan.id)).revision).toBe(2);
    expect(db.query('SELECT * FROM inventory_events WHERE household_id = ?', scope.householdId)).toEqual([]);
  });

  it('deduplicates concurrent creation writes while documenting duplicate initial compute', async () => {
    const db = mealPlanningFixture();
    const serviceInstance = service(db);
    const planning = vi.spyOn(weeklyPlanner, 'planWeeklyMeals');
    const sameIntentBarrier = createBarrier(2);
    db.hooks.beforeStatement = async (event) => {
      if (event.sql.trimStart().startsWith('INSERT INTO generated_meal_plans')) await sameIntentBarrier.wait();
    };

    const sameIntent = await Promise.all([
      generate(serviceInstance, 't07-concurrent-same'),
      generate(serviceInstance, 't07-concurrent-same'),
    ]);
    expect(sameIntent.map((plan) => plan.id)).toEqual([sameIntent[0].id, sameIntent[0].id]);
    expect(sameIntent.map((plan) => plan.revision)).toEqual([1, 1]);
    expect(planning).toHaveBeenCalledTimes(2);
    expect(db.query('SELECT id FROM generated_meal_plans WHERE request_key = ?', 't07-concurrent-same')).toHaveLength(1);

    planning.mockClear();
    const differentIntentBarrier = createBarrier(2);
    db.hooks.beforeStatement = async (event) => {
      if (event.sql.trimStart().startsWith('INSERT INTO generated_meal_plans')) await differentIntentBarrier.wait();
    };
    const differentIntent = await Promise.allSettled([
      generate(serviceInstance, 't07-concurrent-different'),
      serviceInstance.generate(scope, { ...mealPlanningIntent, defaultServings: 3 }, 't07-concurrent-different'),
    ]);
    db.hooks.beforeStatement = undefined;
    expect(differentIntent.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(differentIntent).toContainEqual(expect.objectContaining({
      status: 'rejected', reason: expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    }));
    expect(planning).toHaveBeenCalledTimes(2);
    expect(db.query('SELECT id FROM generated_meal_plans WHERE request_key = ?', 't07-concurrent-different')).toHaveLength(1);
  });

  it('fences feedback by plan revision while retaining exact retry identity', async () => {
    const db = mealPlanningFixture();
    const serviceInstance = service(db);
    const plan = await generate(serviceInstance);
    const beforeInventory = db.query('SELECT * FROM inventory_items ORDER BY id');
    const first = await serviceInstance.feedback(scope, plan.id, { revision: 1, slotId: firstSlot, type: 'liked' }, 't07-feedback');
    const replay = await serviceInstance.feedback(scope, plan.id, { revision: 1, slotId: firstSlot, type: 'liked' }, 't07-feedback');
    expect(replay).toEqual(first);
    await expect(serviceInstance.feedback(scope, plan.id, { revision: 1, slotId: firstSlot, type: 'skipped' }, 't07-feedback'))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(serviceInstance.feedback(
      { householdId: scope.householdId, userId: 't07-persistence-member' },
      plan.id, { revision: 1, slotId: firstSlot, type: 'liked' }, 't07-member-feedback',
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const regenerated = await serviceInstance.regenerate(scope, plan.id, { revision: 1 });
    const laterRevision = await serviceInstance.feedback(
      scope, plan.id, { revision: regenerated.revision, slotId: firstSlot, type: 'liked' }, 't07-feedback',
    );
    expect(laterRevision.id).not.toBe(first.id);
    expect(db.query('SELECT id FROM recipe_feedback_events ORDER BY id')).toHaveLength(2);
    expect(db.query('SELECT * FROM inventory_items ORDER BY id')).toEqual(beforeInventory);
  });

  it('rejects feedback when regeneration commits after its read but before its guarded insert', async () => {
    const db = mealPlanningFixture();
    const serviceInstance = service(db);
    const plan = await generate(serviceInstance);
    let entered!: () => void;
    let release!: () => void;
    const feedbackInsertEntered = new Promise<void>((resolve) => { entered = resolve; });
    const releaseFeedbackInsert = new Promise<void>((resolve) => { release = resolve; });
    db.hooks.beforeStatement = async (event) => {
      if (event.sql.trimStart().startsWith('INSERT INTO recipe_feedback_events')) {
        entered();
        await releaseFeedbackInsert;
      }
    };

    const pendingFeedback = serviceInstance.feedback(
      scope, plan.id, { revision: 1, slotId: firstSlot, type: 'liked' }, 't07-feedback-race',
    );
    await feedbackInsertEntered;
    const regenerated = await serviceInstance.regenerate(scope, plan.id, { revision: 1 });
    release();

    await expect(pendingFeedback).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(regenerated.revision).toBe(2);
    expect(db.query('SELECT * FROM recipe_feedback_events')).toEqual([]);
  });

  it('rejects a shopping result when regeneration makes the source revision stale', async () => {
    const db = mealPlanningFixture();
    let entered!: () => void;
    let release!: () => void;
    const catalogEntered = new Promise<void>((resolve) => { entered = resolve; });
    const releaseCatalog = new Promise<void>((resolve) => { release = resolve; });
    const serviceInstance = service(db, async () => {
      entered();
      await releaseCatalog;
      return { snapshotId: 't07-catalog', options: [], status: 'available' };
    });
    const plan = await generate(serviceInstance);

    const pendingShopping = serviceInstance.shopping(scope, plan.id, { revision: 1, currency: 'VND' });
    await catalogEntered;
    const regenerated = await serviceInstance.regenerate(scope, plan.id, { revision: 1 });
    release();

    await expect(pendingShopping).rejects.toMatchObject({ code: 'PLAN_REVISION_CONFLICT' });
    expect(regenerated.revision).toBe(2);
    expect(db.query('SELECT revision FROM generated_meal_plans WHERE id = ?', plan.id)).toEqual([{ revision: 2 }]);
  });
});
