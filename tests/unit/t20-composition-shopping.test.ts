import { describe, expect, it } from 'vitest';
import { aggregateShoppingDemand } from '../../packages/recipes/src/shopping-demand';
import { projectShoppingMealPlan } from '../../packages/recipes/src/shopping-plan-snapshot';
import {
  compositionShoppingSnapshot,
  projectCompositions,
  type ProjectionSlot,
} from '../../packages/recipes/src/composition/projection';
import type { RecipeDefinition } from '../../packages/recipes/src/foundation';
import type { InventoryLotSnapshot } from '../../packages/recipes/src/planner-inventory';
import { catalog, HOUSEHOLD_ID, lot, recipe } from '../helpers/planner-fixtures';
import { shoppingPlan } from '../helpers/shopping-fixtures';

/**
 * T20E: multi-component shopping must aggregate every component's demand and subtract inventory
 * exactly once. These tests use the real T02 evaluator, T04 projection and T05 aggregation.
 */
const TOMATO = 'TOMATO';
const soup = recipe('tomato-soup', TOMATO, 300);
const salad = recipe('tomato-salad', TOMATO, 300);
const kgStew = recipe('tomato-stew', TOMATO, 0.2, {
  ingredients: [{ ingredientId: TOMATO, name: TOMATO, requiredQuantity: 0.2, unit: 'kg', isOptional: false }],
});
const packDish = recipe('pack-dish', TOMATO, 1, {
  ingredients: [{ ingredientId: TOMATO, name: TOMATO, requiredQuantity: 1, unit: 'pack', isOptional: false }],
});

function scope(recipes: RecipeDefinition[]) {
  return { catalog: catalog(recipes), householdId: HOUSEHOLD_ID, mode: 'shopping_allowed' as const };
}
function tomato(quantity: number, overrides: Partial<InventoryLotSnapshot> = {}) {
  return lot({ id: `lot-tomato-${quantity}-${overrides.expiryDate ?? 'none'}`, ingredientId: TOMATO, quantity, unit: 'g', ...overrides });
}
function slot(date: string, components: ProjectionSlot['components'], servings = 2): ProjectionSlot {
  return { slotId: `${date}:dinner:0`, date, instant: `${date}T12:00:00.000Z`, servings, components };
}
const component = (id: string, recipeId: string) => ({ id, kind: 'recipe' as const, recipeId, simpleFoodId: null });

function demand(recipes: RecipeDefinition[], inventory: InventoryLotSnapshot[], slots: ProjectionSlot[]) {
  const projection = projectCompositions({ scope: scope(recipes), referenceDate: '2026-09-08', inventory, slots });
  const base = projectShoppingMealPlan(shoppingPlan([soup]));
  const snapshot = compositionShoppingSnapshot(base, projection, slots);
  return { projection, snapshot, requirements: aggregateShoppingDemand(snapshot) };
}

describe('T20E aggregate-before-subtract shopping', () => {
  it('same ingredient in two components of one meal: 300 g + 300 g against 500 g buys 100 g (never 0)', () => {
    const inventory = [tomato(500)];
    const { requirements, projection } = demand([soup, salad], inventory,
      [slot('2026-09-09', [component('c-soup', 'tomato-soup'), component('c-salad', 'tomato-salad')])]);
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({ ingredientId: TOMATO, unit: 'g', requiredQuantity: 100, status: 'known' });
    // Per-component independent subtraction would be max(0, 300-500) + max(0, 300-500) = 0: explicitly not the result.
    expect(projection.components.get('c-soup')!.status).toBe('covered');
    expect(projection.components.get('c-salad')!.status).toBe('needs_shopping');
    // Planning never mutates the supplied inventory.
    expect(inventory[0].quantity).toBe(500);
    expect(projection.finalInventory[0]).toMatchObject({ quantity: 0, consumedQuantity: 500, initialQuantity: 500 });
  });

  it('same ingredient across a 7-day plan: 7 × 300 g against 500 g buys exactly 1,600 g', () => {
    const slots = Array.from({ length: 7 }, (_, index) => slot(`2026-09-${String(9 + index).padStart(2, '0')}`,
      [component(`c-${index}`, 'tomato-soup')]));
    const { requirements } = demand([soup], [tomato(500)], slots);
    expect(requirements[0]).toMatchObject({ requiredQuantity: 1600, status: 'known' });
    expect(requirements[0].sourceMealSlots.length).toBe(6);
  });

  it('mixed units normalize to the base unit before the single subtraction (0.2 kg + 300 g vs 250 g → 250 g)', () => {
    const { requirements } = demand([kgStew, salad], [tomato(250)],
      [slot('2026-09-09', [component('c-kg', 'tomato-stew'), component('c-g', 'tomato-salad')])]);
    expect(requirements[0]).toMatchObject({ unit: 'g', requiredQuantity: 250, status: 'known' });
  });

  it('zero inventory buys the full aggregate; overcoverage buys nothing', () => {
    const empty = demand([soup, salad], [], [slot('2026-09-09', [component('a', 'tomato-soup'), component('b', 'tomato-salad')])]);
    expect(empty.requirements[0]).toMatchObject({ requiredQuantity: 600 });
    const plenty = demand([soup, salad], [tomato(2000)], [slot('2026-09-09', [component('a', 'tomato-soup'), component('b', 'tomato-salad')])]);
    expect(plenty.requirements).toEqual([]);
    expect(plenty.projection.finalInventory[0]).toMatchObject({ quantity: 1400 });
  });

  it('multiple lots are consumed expiry-first once; unusable expired use-by stock is never counted', () => {
    const lots = [tomato(200, { id: 'early', expiryDate: '2026-09-10', expiryKind: 'use_by' }),
      tomato(300, { id: 'late', expiryDate: '2026-09-30', expiryKind: 'use_by' }),
      tomato(900, { id: 'expired', expiryDate: '2026-09-01', expiryKind: 'use_by' })];
    const { projection, requirements } = demand([soup, salad], lots,
      [slot('2026-09-09', [component('a', 'tomato-soup')]), slot('2026-09-12', [component('b', 'tomato-salad')])]);
    const first = projection.components.get('a')!;
    expect(first.deltas.map((delta) => [delta.lotId, delta.consumedQuantity])).toEqual([['early', 200], ['late', 100]]);
    expect(requirements[0]).toMatchObject({ requiredQuantity: 100 });
  });

  it('unknown / contextual units stay unresolved instead of inventing a quantity', () => {
    const { requirements, projection } = demand([packDish], [tomato(5000)], [slot('2026-09-09', [component('p', 'pack-dish')])]);
    expect(projection.components.get('p')!.status).toBe('unresolved');
    expect(requirements[0]).toMatchObject({ status: 'unresolved', requiredQuantity: null });
  });

  it('simple foods add demand through the same projection; untracked simple foods add none; unknown dishes are flagged', () => {
    const rice = { id: 'rice', kind: 'simple_food' as const, recipeId: null, simpleFoodId: 'sf-steamed-rice' };
    const fruit = { id: 'fruit', kind: 'simple_food' as const, recipeId: null, simpleFoodId: 'sf-seasonal-fruit' };
    const ghost = component('ghost', 'not-in-authority');
    const { requirements, projection } = demand([soup],
      [lot({ id: 'rice-lot', ingredientId: 'RICE', quantity: 100, unit: 'g' })],
      [slot('2026-09-09', [rice, fruit, ghost], 2)]);
    expect(projection.components.get('rice')!.status).toBe('needs_shopping');
    expect(projection.components.get('fruit')!.status).toBe('not_tracked');
    expect(projection.components.get('ghost')!.status).toBe('unavailable');
    expect(requirements).toEqual([expect.objectContaining({ ingredientId: 'RICE', requiredQuantity: 60 })]);
  });

  it('past slots are skipped and the untilSlot stop exposes the inventory an assisted slot plans against', () => {
    const slots = [slot('2026-09-07', [component('past', 'tomato-soup')]), slot('2026-09-09', [component('a', 'tomato-soup')]),
      slot('2026-09-10', [component('b', 'tomato-salad')])];
    const projection = projectCompositions({ scope: scope([soup, salad]), referenceDate: '2026-09-08', inventory: [tomato(500)],
      slots, untilSlotId: slots[2].slotId });
    expect(projection.skippedPastSlots).toEqual([slots[0].slotId]);
    expect(projection.inventoryAtStop![0].quantity).toBe(200);
    expect(projection.components.has('b')).toBe(false);
  });
});
