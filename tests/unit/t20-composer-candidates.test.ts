import { describe, expect, it } from 'vitest';
import type { MealRole } from '../../packages/domain/src/meal-composition-api';
import { prepareComposerCandidates, recipeKey } from '../../packages/recipes/src/composition/candidates';
import { COMPOSITION_BUDGET } from '../../packages/recipes/src/composition/composer';
import { buildRoleIndex, type PersistedRoleAssignment } from '../../packages/recipes/src/composition/roles';
import type { RecipeDefinition } from '../../packages/recipes/src/foundation';
import { readPlanningContext } from '../../packages/recipes/src/planner-context';
import { projectInventoryRows } from '../../packages/recipes/src/planner-inventory';
import type { Recipe } from '../../packages/recipes/src/types';
import { catalog, context, HOUSEHOLD_ID, lot, recipe, USER_ID } from '../helpers/planner-fixtures';

const slot = { date: '2026-09-09', instant: '2026-09-09T18:00:00+07:00', servings: 2, mealType: 'dinner' as const };
const desiredRoles: MealRole[] = ['main', 'staple', 'vegetable', 'soup'];

function fixture(mainCount: number, reversed = false) {
  const definitions = [
    ...Array.from({ length: mainCount }, (_, index) => recipe(`main-${String(index).padStart(3, '0')}`, 'CHICKEN', 100,
      { cuisine: index === mainCount - 1 ? 'favorite' : 'ordinary', prepTimeMinutes: 0 })),
    recipe('staple-only', 'CHICKEN', 100, { prepTimeMinutes: 0 }),
    recipe('vegetable-only', 'CHICKEN', 100, { prepTimeMinutes: 0 }),
    recipe('soup-only', 'CHICKEN', 100, { prepTimeMinutes: 0 }),
    recipe('shared-soup-vegetable', 'CHICKEN', 100, { prepTimeMinutes: 0 }),
  ];
  const roles = (definition: RecipeDefinition): MealRole[] => definition.id.startsWith('main-') ? ['main']
    : definition.id === 'staple-only' ? ['staple'] : definition.id === 'vegetable-only' ? ['vegetable']
      : definition.id === 'soup-only' ? ['soup'] : ['vegetable', 'soup'];
  const runtime: Recipe[] = definitions.map((definition) => ({
    id: definition.id, slug: definition.slug, title: definition.title, description: '', cuisine: 'vietnamese',
    cookTimeMinutes: definition.cookTimeMinutes!, servings: definition.servings, difficulty: 'easy', imageUrl: '',
    ingredients: definition.ingredients.map((line) => ({ ingredientId: line.ingredientId, name: line.name,
      requiredQuantity: line.requiredQuantity, unit: line.unit, isOptional: line.isOptional })),
    steps: [], tags: [],
  }));
  const assignments: PersistedRoleAssignment[] = definitions.flatMap((definition) => roles(definition).map((role) => ({
    recipeId: definition.id, role, source: 'reviewed', decision: 'assign', confidence: null, reviewed: true,
  })));
  const ctx = context({
    catalog: catalog(reversed ? [...definitions].reverse() : definitions),
    inventory: [lot({ ingredientId: 'CHICKEN', quantity: 1000 })],
    rankingContext: { householdId: HOUSEHOLD_ID, userId: USER_ID, feedback: [],
      preferences: [{ householdId: HOUSEHOLD_ID, userId: null, values: { preferredCuisines: ['favorite'] } }] },
  });
  return { ctx, roleIndex: buildRoleIndex(runtime, assignments), definitions };
}

function prepared(mainCount: number, reversed = false, usedElsewhere = new Set<string>()) {
  const { ctx, roleIndex } = fixture(mainCount, reversed);
  return prepareComposerCandidates({ context: ctx, roleIndex, slot,
    inventory: projectInventoryRows(readPlanningContext(ctx).inventory),
    roles: desiredRoles, mode: 'shopping_allowed', excludeKeys: new Set(), usedElsewhere });
}

describe('T20 composer candidate pool is bounded at its own boundary', () => {
  it('320 eligible recipes + simple foods share one absolute 320-slot cap, without starving scarce roles', () => {
    const candidates = prepared(316);
    const simpleFoods = candidates.filter((candidate) => candidate.kind === 'simple_food');
    expect(candidates).toHaveLength(COMPOSITION_BUDGET.maxCatalogCandidates);
    expect(candidates.length).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxCatalogCandidates);
    expect(simpleFoods.length).toBeGreaterThan(0);
    expect(candidates.filter((candidate) => candidate.kind === 'recipe')).toHaveLength(320 - simpleFoods.length);
    for (const role of desiredRoles) expect(candidates.some((candidate) => candidate.roles.includes(role))).toBe(true);
    expect(candidates.some((candidate) => candidate.id === 'staple-only')).toBe(true);
    expect(candidates.some((candidate) => candidate.id === 'vegetable-only')).toBe(true);
    expect(candidates.some((candidate) => candidate.id === 'soup-only')).toBe(true);
    expect(candidates.some((candidate) => candidate.id === 'shared-soup-vegetable')).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.key)).size).toBe(candidates.length);
  });

  it('ranks every eligible recipe before the cap: a favorite last in the catalog stays, regardless of input order', () => {
    const first = prepared(340);
    expect(first).toHaveLength(320);
    expect(first.map((candidate) => candidate.id)).toContain('main-339');
    expect(prepared(340, true)).toEqual(first);
    expect(prepared(340)).toEqual(first);
  });

  it('still applies hard eligibility, excludes wrong roles, and preserves the used-elsewhere preference penalty', () => {
    const { ctx, roleIndex, definitions } = fixture(6);
    const source = readPlanningContext(ctx);
    const used = new Set([recipeKey('main-005')]);
    const input = { context: ctx, roleIndex, slot, inventory: projectInventoryRows(source.inventory),
      roles: desiredRoles, mode: 'shopping_allowed' as const, excludeKeys: new Set([recipeKey('main-001')]),
      usedElsewhere: new Set<string>() };
    const base = prepareComposerCandidates(input);
    const penalized = prepareComposerCandidates({ ...input, usedElsewhere: used });
    expect(base.some((candidate) => candidate.id === 'main-001')).toBe(false);
    expect(penalized.find((candidate) => candidate.id === 'main-005')!.preference)
      .toBeCloseTo(base.find((candidate) => candidate.id === 'main-005')!.preference * 0.7);
    expect(penalized.map((candidate) => candidate.key)).toEqual(base.map((candidate) => candidate.key));
    expect(base.every((candidate) => candidate.roles.some((role) => desiredRoles.includes(role)))).toBe(true);
    const restricted = context({ catalog: catalog(definitions), inventory: [lot({ ingredientId: 'CHICKEN', quantity: 1000 })],
      rankingContext: { householdId: HOUSEHOLD_ID, userId: USER_ID, feedback: [],
        preferences: [{ householdId: HOUSEHOLD_ID, userId: null,
          values: { neverRecommendRecipeIds: ['main-005'], forbiddenIngredientIds: ['RICE'] } }] } });
    const restrictedCandidates = prepareComposerCandidates({ ...input, context: restricted,
      inventory: projectInventoryRows(readPlanningContext(restricted).inventory) });
    expect(restrictedCandidates.some((candidate) => candidate.id === 'main-005')).toBe(false);
    expect(restrictedCandidates.some((candidate) => candidate.id === 'sf-steamed-rice')).toBe(false);
    expect(restrictedCandidates.some((candidate) => candidate.id === 'main-000')).toBe(true);
  });
});
