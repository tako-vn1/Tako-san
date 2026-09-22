import { describe, expect, it } from 'vitest';
import { optimizeShopping } from '../../packages/recipes/src/shopping-optimizer';
import { ShoppingPolicySchema } from '../../packages/recipes/src/shopping-policy';
import { recipe } from '../helpers/planner-fixtures';
import {
  purchaseOption,
  shoppingBudget,
  shoppingContext,
  shoppingPlan,
  shoppingSource,
} from '../helpers/shopping-fixtures';

describe('T05 review counterexamples', () => {
  it('does not prove an impossible budget after excluding a usable early-meal package', () => {
    const plan = shoppingPlan([recipe('early', 'CHICKEN', 300), recipe('late', 'CHICKEN', 300)]);
    const options = [
      purchaseOption('early-price', 300, 100, {
        expiry: { date: '2026-09-08', kind: 'use_by', sourceReference: 'early-label' },
      }),
      purchaseOption('late-price', 300, 500, {
        expiry: { date: '2026-09-10', kind: 'use_by', sourceReference: 'late-label' },
      }),
    ];
    const result = optimizeShopping({
      context: shoppingContext(shoppingSource(plan, options, { budget: shoppingBudget(600) })),
    });
    expect(result.cost.totalCostMinor).toBe('1000');
    expect(result.cost.minimumCostMinor).toBeNull();
    expect(result.cost.provenKnownCostLowerBoundMinor).toBe('0');
    expect(result.budget.status).toBe('unknown');
    expect(result.budget.provenGapMinor).toBe('0');
    expect(result.optimization.exhaustive).toBe(false);
    expect(result.optimization.truncated).toBe(false);
    expect(result.diagnostics.some((row) => row.code === 'BUDGET_INFEASIBLE')).toBe(false);
  });

  it('reports a lossy aggregate boundary as unresolved rather than buying too little at an exact budget', () => {
    // T19: real 3-serving legacy recipes planned at 2 servings twice aggregate to a non-terminating
    // rational. Rounding is still forbidden; the truthful result is an unresolved requirement with no
    // purchase line and an unknown budget — never a thrown 500 and never an under-purchase.
    const plan = shoppingPlan([recipe('large', 'CHICKEN', 1), recipe('tiny', 'CHICKEN', 5e-17)]);
    expect(plan.slots).toHaveLength(2);
    const context = shoppingContext(
      shoppingSource(plan, [purchaseOption('one-gram', 1, 100)], { budget: shoppingBudget(100) }),
    );
    const result = optimizeShopping({ context });
    expect(result.purchaseLines).toEqual([]);
    expect(result.unresolvedRequirements).toEqual([
      expect.objectContaining({ code: 'UNRESOLVED_PURCHASE_QUANTITY', requirement: expect.objectContaining({
        ingredientId: 'CHICKEN', status: 'unresolved', requiredQuantity: null, knownRequiredQuantity: 0, unresolvedCount: 2,
      }) }),
    ]);
    expect(result.cost.totalCostMinor).toBeNull();
    expect(result.budget.status).toBe('unknown');
    expect(result.optimization.exhaustive).toBe(false);
    expect(result.optimization.incompleteReasons).toContain('UNRESOLVED_PURCHASE_QUANTITY');
  });

  it('rejects a lossy purchased-quantity witness instead of rounding package contents', () => {
    const context = shoppingContext(
      shoppingSource(shoppingPlan([recipe('meal', 'CHICKEN', 1)]), [
        purchaseOption('a', 0.6, 1),
        purchaseOption('b', 0.4000000000000001, 1),
      ]),
    );
    expect(() => optimizeShopping({ context })).toThrow(/exact.*quantity|quantity.*exact/i);
  });

  it('buys one ten-piece egg carton for two eggs without rounding the requirement', () => {
    const meal = recipe('eggs', 'EGG', 2);
    meal.ingredients[0].unit = 'piece';
    const result = optimizeShopping({
      context: shoppingContext(
        shoppingSource(shoppingPlan([meal]), [
          purchaseOption('carton', 10, 250, {
            ingredientId: 'EGG',
            packageContent: { quantity: 10, unit: 'piece', sourceReference: 'ten-eggs' },
          }),
        ]),
      ),
    });
    expect(result.purchaseLines[0]).toMatchObject({
      requiredQuantity: 2,
      purchasedQuantity: 10,
      surplusQuantity: 8,
    });
    expect(result.purchaseLines[0].selectedPackages[0].packageCount).toBe(1);
  });

  it('deduplicates semantically identical offers even when snapshot row IDs differ', () => {
    const option = purchaseOption('a', 700, 500);
    const duplicate = { ...structuredClone(option), id: 'b' };
    const result = optimizeShopping({
      context: shoppingContext(shoppingSource(shoppingPlan(), [duplicate, option])),
    });
    expect(result.optimization.requirements[0].optionsAvailable).toBe(1);
    expect(result.purchaseLines[0].selectedPackages[0].purchaseOptionId).toBe('a');
  });

  it('chooses an affordable intermediate surplus improvement under a hard budget', () => {
    const plan = shoppingPlan([recipe('meal', 'CHICKEN', 100)]);
    const options = [
      purchaseOption('bulk', 200, 100),
      purchaseOption('middle', 150, 105),
      purchaseOption('exact', 100, 110),
    ];
    const result = optimizeShopping({
      context: shoppingContext(shoppingSource(plan, options, { budget: shoppingBudget(105) })),
      policy: { objective: 'bounded_surplus', surplusPremiumBps: 1000 },
    });
    expect(result.purchaseLines[0].selectedPackages[0].purchaseOptionId).toBe('middle');
    expect(result.purchaseLines[0].surplusQuantity).toBe(50);
    expect(result.cost.totalCostMinor).toBe('105');
    expect(result.budget.status).toBe('within_budget');
  });

  it('does not claim a minimum or impossible budget after an option cap', () => {
    const plan = shoppingPlan([recipe('meal', 'CHICKEN', 100)]);
    const result = optimizeShopping({
      context: shoppingContext(
        shoppingSource(plan, [purchaseOption('a', 100, 500), purchaseOption('b', 100, 100)], {
          budget: shoppingBudget(100),
        }),
      ),
      policy: { maxOptionsPerRequirement: 1 },
    });
    expect(result.cost).toMatchObject({
      totalCostMinor: '500',
      bestKnownCompleteCostMinor: '500',
      minimumCostMinor: null,
    });
    expect(result.budget).toMatchObject({
      status: 'unknown',
      provenGapMinor: '0',
      selectedKnownGapMinor: '400',
    });
    expect(result.optimization).toMatchObject({
      exhaustive: false,
      searchExhaustive: false,
      truncated: true,
    });
    expect(result.diagnostics.some((row) => row.code === 'OPTIMIZATION_TRUNCATED')).toBe(true);
    expect(result.purchaseLines[0].reasons).not.toContain('LOWEST_KNOWN_COST');
  });

  it('does not let already-expired use-by stock invalidate a known-price proof', () => {
    const plan = shoppingPlan([recipe('meal', 'CHICKEN', 100)]);
    const result = optimizeShopping({
      context: shoppingContext(
        shoppingSource(
          plan,
          [
            purchaseOption('expired', 100, 1, {
              expiry: { date: '2026-09-07', kind: 'use_by', sourceReference: 'expired-label' },
            }),
            purchaseOption('fresh', 100, 500),
          ],
          { budget: shoppingBudget(100) },
        ),
      ),
    });
    expect(result.cost.minimumCostMinor).toBe('500');
    expect(result.budget.status).toBe('over_budget');
    expect(result.optimization.exhaustive).toBe(true);
  });

  it('retains unknown-price alternatives in budget feedback even when the selected purchase is priced', () => {
    const result = optimizeShopping({
      context: shoppingContext(
        shoppingSource(
          shoppingPlan(),
          [purchaseOption('known', 700, 500), purchaseOption('unknown', 700, null)],
          { budget: shoppingBudget(100) },
        ),
      ),
    });
    expect(result.cost.totalCostMinor).toBe('500');
    expect(result.budget.unknownPriceRequirementIds).toEqual([result.requirements[0].id]);
    expect(result.budget.status).toBe('unknown');
  });

  it.each([
    { maxTotalStates: 0 },
    { maxTotalStates: 65537 },
    { maxStatesPerRequirement: 16385 },
    { maxOptionsPerRequirement: 33 },
    { maxPackagesPerRequirement: 1025 },
    { maxTotalStates: 1.5 },
    { surplusPremiumBps: 2501 },
    { maxPriceAgeDays: -1 },
  ])('rejects invalid or unbounded optimization policy %j', (policy) => {
    expect(ShoppingPolicySchema.safeParse(policy).success).toBe(false);
  });
});
