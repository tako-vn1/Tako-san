import { describe, expect, it } from 'vitest';
import { MAX_COMPONENTS_PER_MEAL, type MealRole } from '../../packages/domain/src/meal-composition-api';
import {
  addComponent,
  applyGenerated,
  CompositionDomainError,
  projectV1Composition,
  removeComponent,
  replaceComponents,
  swapComponent,
  updateComponent,
  type CompositionContext,
  type MealComponent,
  type MealComposition,
} from '../../packages/recipes/src/composition/model';
import {
  auditRoleDistribution,
  buildRoleIndex,
  classifyRecipeRoles,
  resolveRecipeRoles,
} from '../../packages/recipes/src/composition/roles';
import { compatibilityIssues, hasHardIssue, missingRoles } from '../../packages/recipes/src/composition/profiles';
import {
  composeMeal,
  COMPOSITION_BUDGET,
  scoreComposition,
  type ComposerCandidate,
  type ComposerFixed,
} from '../../packages/recipes/src/composition/composer';
import { SIMPLE_FOODS } from '../../packages/recipes/src/composition/simple-foods';
import type { Recipe } from '../../packages/recipes/src/types';

function runtime(id: string, title: string, overrides: Partial<Recipe> = {}): Recipe {
  return { id, slug: id, title, description: '', cuisine: 'vietnamese', cookTimeMinutes: 20, servings: 2, difficulty: 'easy',
    imageUrl: '', ingredients: [{ ingredientId: 'CABBAGE', name: 'Bắp cải', requiredQuantity: 1, unit: 'piece' }],
    steps: [{ stepNumber: 1, instruction: 'x' }], tags: [], ...overrides };
}
const egg = [{ ingredientId: 'CHICKEN_EGG', name: 'Trứng gà', requiredQuantity: 2, unit: 'piece' as const }];

describe('T20 recipe roles', () => {
  it('assigns multiple roles, traits and rule provenance without fabricating confidence', () => {
    const friedEgg = classifyRecipeRoles(runtime('egg', 'Trứng ốp la', { ingredients: egg, cookTimeMinutes: 5 }));
    expect(friedEgg.roles).toEqual(['main', 'side', 'simple_food']);
    expect(friedEgg.assignments.every((entry) => entry.source === 'rule' && entry.confidence === null && !entry.reviewed)).toBe(true);
    expect(classifyRecipeRoles(runtime('salad', 'Gỏi bắp cải')).roles).toEqual(['side', 'vegetable']);
    expect(classifyRecipeRoles(runtime('rice', 'Cơm trắng', { cookTimeMinutes: 25 })).roles).toEqual(['staple', 'simple_food']);
    const soup = classifyRecipeRoles(runtime('soup', 'Canh bí đao', { category: 'mon_canh' }));
    expect(soup.roles).toEqual(['soup']);
    expect(soup.traits).toContain('brothy');
    const pho = classifyRecipeRoles(runtime('pho', 'Phở bò', { category: 'mon_bun_pho' }));
    expect(pho.roles).toEqual(['main']);
    expect(pho.traits).toEqual(['brothy', 'complete_meal', 'includes_staple']);
    expect(classifyRecipeRoles(runtime('che', 'Chè đậu xanh')).roles).toEqual(['dessert']);
    const unknown = classifyRecipeRoles(runtime('x', 'Món lạ', { ingredients: [] }));
    expect(unknown.reviewRequired).toBe(true);
    expect(unknown.reviewReasons).toEqual(['FALLBACK_ROLE']);
  });

  it('human-reviewed roles outrank inferred ones; reviewed rejections remove roles; low-confidence AI stays in review', () => {
    const rule = classifyRecipeRoles(runtime('salad', 'Gỏi bắp cải'));
    const reviewed = resolveRecipeRoles(rule, [{ recipeId: 'salad', role: 'vegetable', source: 'reviewed', decision: 'assign', confidence: null, reviewed: true }]);
    expect(reviewed.roles).toEqual(['vegetable']);
    expect(reviewed.assignments[0]).toMatchObject({ source: 'reviewed', reviewed: true });
    const rejected = resolveRecipeRoles(rule, [{ recipeId: 'salad', role: 'side', source: 'reviewed', decision: 'reject', confidence: null, reviewed: true }]);
    expect(rejected.roles).toEqual(['vegetable']);
    const ai = resolveRecipeRoles(rule, [
      { recipeId: 'salad', role: 'dessert', source: 'ai', decision: 'assign', confidence: 0.4, reviewed: false },
      { recipeId: 'salad', role: 'simple_food', source: 'ai', decision: 'assign', confidence: 0.95, reviewed: false },
    ]);
    expect(ai.roles).toEqual(['side', 'vegetable', 'simple_food']);
    expect(ai.reviewRequired).toBe(true);
    expect(ai.reviewReasons).toEqual(['LOW_CONFIDENCE_AI_ROLE']);
    // Rows for recipes outside the authority universe never extend it.
    const index = buildRoleIndex([runtime('salad', 'Gỏi bắp cải')], [{ recipeId: 'invisible', role: 'main', source: 'reviewed', decision: 'assign', confidence: null, reviewed: true }]);
    expect(index.profiles.map((profile) => profile.recipeId)).toEqual(['salad']);
    expect(auditRoleDistribution(index)).toMatchObject({ unclassified: [], invalidRoles: [], duplicateAssignments: [], contradictions: [] });
  });

  it('simple foods have explicit roles and never claim nutrition', () => {
    expect(SIMPLE_FOODS.every((food) => food.roles.includes('simple_food') && food.id.startsWith('sf-'))).toBe(true);
    expect(JSON.stringify(SIMPLE_FOODS)).not.toMatch(/calor|protein|kcal/i);
  });
});

const allRoles: MealRole[] = ['main', 'side', 'vegetable', 'soup', 'staple', 'dessert', 'simple_food'];
function ctx(revision = 5, permitted: MealRole[] = allRoles): CompositionContext {
  let next = 0;
  return { resolve: (target) => (target.kind === 'recipe' && target.recipeId.startsWith('missing') ? null : { permittedRoles: permitted }),
    newId: () => `new-${++next}`, revision };
}
const v1 = projectV1Composition({ slotId: '2030-01-02:dinner:0', meal: { source: { kind: 'recipe', id: 'pho-bo' } }, locked: false, revision: 4 });

describe('T20 composition domain', () => {
  it('a V1 slot "Dinner → pho-bo" is the one-component composition main: pho-bo (legacy_v1)', () => {
    expect(v1).toEqual({ slotId: '2030-01-02:dinner:0', source: 'v1_projection', mode: null, components: [{
      id: 'v1.2030-01-02:dinner:0', kind: 'recipe', role: 'main', ordinal: 0, locked: false, provenance: 'legacy_v1',
      recipeId: 'pho-bo', simpleFoodId: null, createdRevision: 4, updatedRevision: 4 }] });
    expect(projectV1Composition({ slotId: 's', meal: { source: { kind: 'family', id: 'f' } }, locked: false, revision: 1 }).components).toEqual([]);
    expect(projectV1Composition({ slotId: 's', meal: null, locked: false, revision: 1 }).components).toEqual([]);
  });

  it('add / swap / update / remove / replace keep invariants and provenance', () => {
    const added = addComponent(v1, { target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple', locked: true }, ctx());
    expect(added.map((item) => [item.id, item.ordinal, item.provenance, item.locked])).toEqual([
      ['v1.2030-01-02:dinner:0', 0, 'legacy_v1', false], ['new-1', 1, 'manual', true]]);
    const composition: MealComposition = { ...v1, source: 'v2', mode: 'manual', components: added };
    const swapped = swapComponent(composition, 'v1.2030-01-02:dinner:0', { target: { kind: 'recipe', recipeId: 'bun-cha' } }, ctx(6));
    expect(swapped[0]).toMatchObject({ id: 'v1.2030-01-02:dinner:0', recipeId: 'bun-cha', provenance: 'manual', createdRevision: 4, updatedRevision: 6 });
    const moved = updateComponent(composition, 'new-1', { ordinal: 0, locked: false }, ctx());
    expect(moved.map((item) => item.id)).toEqual(['new-1', 'v1.2030-01-02:dinner:0']);
    expect(moved[0].locked).toBe(false);
    expect(removeComponent(composition, 'new-1')).toHaveLength(1);
    const replaced = replaceComponents(composition, [
      { id: 'new-1', target: { kind: 'simple_food', simpleFoodId: 'sf-steamed-rice' }, role: 'staple', locked: true },
      { id: 'v1.2030-01-02:dinner:0', target: { kind: 'recipe', recipeId: 'pho-bo' }, role: 'main', locked: false },
    ], ctx(7));
    expect(replaced.map((item) => [item.id, item.provenance, item.updatedRevision])).toEqual([
      ['new-1', 'manual', 7], ['v1.2030-01-02:dinner:0', 'legacy_v1', 7]]);
  });

  it('rejects duplicates, unknown targets, unpermitted roles, unknown components and over-limit meals', () => {
    const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return (error as CompositionDomainError).code; } };
    expect(code(() => addComponent(v1, { target: { kind: 'recipe', recipeId: 'pho-bo' }, role: 'main', locked: true }, ctx()))).toBe('DUPLICATE_COMPONENT');
    expect(code(() => addComponent(v1, { target: { kind: 'recipe', recipeId: 'missing-1' }, role: 'main', locked: true }, ctx()))).toBe('TARGET_NOT_FOUND');
    expect(code(() => addComponent(v1, { target: { kind: 'recipe', recipeId: 'x' }, role: 'soup', locked: true }, ctx(5, ['main'])))).toBe('ROLE_NOT_PERMITTED');
    expect(code(() => removeComponent(v1, 'nope'))).toBe('COMPONENT_NOT_FOUND');
    let composition: MealComposition = { ...v1, source: 'v2', mode: 'manual' };
    const shared = ctx();
    for (let index = 1; index < MAX_COMPONENTS_PER_MEAL; index++) {
      composition = { ...composition, components: addComponent(composition, { target: { kind: 'recipe', recipeId: `r${index}` }, role: 'side', locked: false }, shared) };
    }
    expect(code(() => addComponent(composition, { target: { kind: 'recipe', recipeId: 'r99' }, role: 'side', locked: false }, shared))).toBe('COMPONENT_LIMIT');
  });

  it('property: generated application never changes, removes or unlocks a locked component (1,000 seeded cases)', () => {
    let seed = 20_2020;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let run = 0; run < 1000; run++) {
      const size = 1 + Math.floor(random() * 6);
      const components: MealComponent[] = Array.from({ length: size }, (_, index) => ({
        id: `c${index}`, kind: 'recipe', role: allRoles[Math.floor(random() * allRoles.length)], ordinal: index, locked: random() < 0.5,
        provenance: 'manual', recipeId: `r${index}`, simpleFoodId: null, createdRevision: 1, updatedRevision: 1 }));
      const composition: MealComposition = { slotId: 's', source: 'v2', mode: 'manual', components };
      const removeIds = components.filter(() => random() < 0.6).map((item) => item.id);
      const additions = Array.from({ length: Math.floor(random() * 3) }, (_, index) => ({
        target: { kind: 'recipe' as const, recipeId: `add-${index}` }, role: 'side' as MealRole }));
      let result: MealComponent[] | null = null;
      try { result = applyGenerated(composition, { removeIds, additions, provenance: 'auto' }, ctx()); }
      catch (error) {
        expect((error as CompositionDomainError).code).toMatch(/LOCKED_COMPONENT|COMPONENT_LIMIT/);
        if ((error as CompositionDomainError).code === 'LOCKED_COMPONENT') {
          expect(removeIds.some((id) => components.find((item) => item.id === id)!.locked)).toBe(true);
        }
        continue;
      }
      for (const locked of components.filter((item) => item.locked)) {
        expect({ ...result.find((item) => item.id === locked.id)!, ordinal: 0 }).toEqual({ ...locked, ordinal: 0 });
      }
      expect(result.filter((item) => !components.some((old) => old.id === item.id)).every((item) => item.provenance === 'auto' && !item.locked)).toBe(true);
    }
  });
});

function candidate(id: string, roles: MealRole[], overrides: Partial<ComposerCandidate> = {}): ComposerCandidate {
  return { key: `recipe:${id}`, kind: 'recipe', id, title: id, roles, traits: [], dominantIngredientId: null, preference: 0.5,
    coverage: 1, missingIngredientIds: [], inventoryIngredientIds: [`${id}-ing`], ingredientIds: [`${id}-ing`], cookMinutes: 20, ...overrides };
}
const lockedMain: ComposerFixed = { ...candidate('locked-main', ['main']), componentId: 'c-main', role: 'main', locked: true };

describe('T20 bounded composition search', () => {
  const pool = Array.from({ length: 500 }, (_, index) => candidate(`r${String(index).padStart(3, '0')}`,
    [allRoles[index % 6]], { preference: (index % 17) / 17, coverage: (index % 5) / 4,
      dominantIngredientId: `protein-${index % 9}`, traits: index % 6 === 3 ? ['brothy'] : [] }));

  it('500-candidate catalog: never enumerates combinations, stays inside explicit budgets and returns ≤ 3 options quickly', () => {
    const started = performance.now();
    const result = composeMeal({ mealType: 'dinner', fixed: [], rolesToFill: missingRoles('dinner', [], 'recommended'), candidates: pool, variant: 0, maxOptions: 3 });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(250);
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options.length).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxOptions);
    expect(result.budget.anchorsConsidered).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxAnchors);
    expect(result.budget.candidatesConsidered).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxAnchors + 3 * COMPOSITION_BUDGET.maxCandidatesPerRole);
    // 500^4 dinner combinations would be 6.25e10; the beam explores a few hundred partials.
    expect(result.budget.partialsExplored).toBeLessThan(400);
    expect(result.budget.partialsExplored).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxPartials);
    expect(result.budget.scoringOperations).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxScoringOperations);
    expect(result.budget.scoringOperations).toBeLessThan(400);
    for (const option of result.options) {
      const roles = option.items.map((item) => item.role);
      expect(roles.filter((role) => role === 'main')).toHaveLength(1);
      expect(compatibilityIssues(option.items.map((item) => ({ key: item.candidate!.key, kind: 'recipe', id: item.candidate!.id, role: item.role,
        traits: item.candidate!.traits, dominantIngredientId: item.candidate!.dominantIngredientId })))).not.toContain('MULTIPLE_SOUPS');
      const sum = Object.values(option.score.parts).length;
      expect(sum).toBe(7);
    }
  });

  it('is deterministic for identical inputs; variant is the only bounded source of variation', () => {
    const input = { mealType: 'dinner' as const, fixed: [lockedMain], rolesToFill: ['staple', 'vegetable', 'soup'] as MealRole[], candidates: pool, variant: 0, maxOptions: 3 };
    expect(composeMeal(input)).toEqual(composeMeal({ ...input, candidates: [...pool].reverse() }));
    const other = composeMeal({ ...input, variant: 4 });
    expect(other.options.every((option) => option.items.some((item) => item.fixed?.componentId === 'c-main'))).toBe(true);
  });

  it('keeps locked components in every option and never adds a second main', () => {
    const result = composeMeal({ mealType: 'dinner', fixed: [lockedMain], rolesToFill: missingRoles('dinner', [{ key: lockedMain.key, kind: 'recipe',
      id: lockedMain.id, role: 'main', traits: [], dominantIngredientId: null }], 'recommended'), candidates: pool, variant: 0, maxOptions: 3 });
    for (const option of result.options) {
      expect(option.items[0].fixed).toBe(lockedMain);
      expect(option.items.filter((item) => item.role === 'main')).toHaveLength(1);
      expect(option.explanations).toContainEqual({ code: 'LOCKED_PRESERVED', count: 1, role: null });
    }
  });

  it('fails safe when a budget is exhausted: reports exhaustion and returns the best bounded partial', () => {
    const result = composeMeal({ mealType: 'dinner', fixed: [], rolesToFill: ['main', 'staple', 'vegetable', 'soup'], candidates: pool,
      variant: 0, maxOptions: 3, budget: { maxPartials: 5 } });
    expect(result.budget.exhausted).toBe(true);
    expect(result.budget.partialsExplored).toBeLessThanOrEqual(5);
    expect(result.options.length).toBeGreaterThan(0);
  });

  it('enforces the scoring hard cap across many candidates and roles and returns deterministic compatible results', () => {
    const input = { mealType: 'dinner' as const, fixed: [], rolesToFill: ['main', 'staple', 'vegetable', 'soup'] as MealRole[],
      candidates: pool, variant: 0, maxOptions: 3, budget: { maxScoringOperations: 3 } };
    const result = composeMeal(input);
    expect(result.budget.exhausted).toBe(true);
    expect(result.budget.scoringOperations).toBe(3);
    expect(result.budget.scoringOperations).toBeLessThanOrEqual(3);
    expect(result.budget.partialsExplored).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxPartials);
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      const issues = compatibilityIssues(option.items.map(({ role, fixed, candidate: added }) => {
        const source = fixed ?? added!;
        return { key: source.key, kind: source.kind, id: source.id, role, traits: source.traits,
          dominantIngredientId: source.dominantIngredientId };
      }));
      expect(hasHardIssue(issues)).toBe(false);
    }
    expect(result).toEqual(composeMeal({ ...input, candidates: [...pool].reverse() }));
  });

  it('stops before a second score at a one-operation limit without throwing', () => {
    const result = composeMeal({ mealType: 'dinner', fixed: [], rolesToFill: ['main', 'staple', 'vegetable', 'soup'], candidates: pool,
      variant: 0, maxOptions: 3, budget: { maxScoringOperations: 1 } });
    expect(result.budget.exhausted).toBe(true);
    expect(result.budget.scoringOperations).toBe(1);
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.budget.partialsExplored).toBeLessThanOrEqual(COMPOSITION_BUDGET.maxPartials);
  });

  it('preserves locked components when the scoring budget is exhausted', () => {
    const result = composeMeal({ mealType: 'dinner', fixed: [lockedMain], rolesToFill: ['staple', 'vegetable', 'soup'], candidates: pool,
      variant: 0, maxOptions: 3, budget: { maxScoringOperations: 1 } });
    expect(result.budget.exhausted).toBe(true);
    expect(result.budget.scoringOperations).toBe(1);
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.items.some((item) => item.fixed === lockedMain)).toBe(true);
      expect(hasHardIssue(compatibilityIssues(option.items.map(({ role, fixed, candidate: added }) => {
        const source = fixed ?? added!;
        return { key: source.key, kind: source.kind, id: source.id, role, traits: source.traits,
          dominantIngredientId: source.dominantIngredientId };
      })))).toBe(false);
    }
  });

  it('scores an empty-role composition once without crashing', () => {
    const result = composeMeal({ mealType: 'dinner', fixed: [], rolesToFill: [], candidates: [], variant: 0, maxOptions: 3 });
    expect(result.options).toHaveLength(1);
    expect(result.options[0].items).toEqual([]);
    expect(result.budget.scoringOperations).toBe(1);
    expect(result.budget.exhausted).toBe(false);
  });

  it('does not score output when the scoring budget is zero', () => {
    const result = composeMeal({ mealType: 'dinner', fixed: [], rolesToFill: [], candidates: [], variant: 0, maxOptions: 3,
      budget: { maxScoringOperations: 0 } });
    expect(result.options).toEqual([]);
    expect(result.budget.scoringOperations).toBe(0);
    expect(result.budget.exhausted).toBe(true);
  });

  it('scores are decomposable and bounded; one-dish mains imply staple/soup coverage', () => {
    const pho = candidate('pho', ['main'], { traits: ['brothy', 'complete_meal', 'includes_staple'] });
    const score = scoreComposition('dinner', [{ role: 'main', fixed: null, candidate: pho }]);
    expect(score.parts.roleCompleteness).toBe(0.75);
    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(1);
    const withRice = compatibilityIssues([{ key: pho.key, kind: 'recipe', id: 'pho', role: 'main', traits: pho.traits, dominantIngredientId: null },
      { key: 'simple_food:sf-steamed-rice', kind: 'simple_food', id: 'sf-steamed-rice', role: 'staple', traits: [], dominantIngredientId: null }]);
    expect(withRice).toContain('STAPLE_CONFLICT');
  });
});
