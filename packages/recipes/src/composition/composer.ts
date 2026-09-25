import { compareIds } from '../../../domain/src/availability';
import { MEAL_ROLES, type MealRole } from '../../../domain/src/meal-composition-api';
import {
  compatibilityIssues,
  coveredRoles,
  hasHardIssue,
  MEAL_PROFILES,
  type ComposableItem,
  type MealType,
} from './profiles';
import type { RecipeTrait } from './roles';

/**
 * T20 bounded hierarchical composition search shared by Assisted and Auto. It never enumerates
 * a Cartesian product: at most `maxAnchors` mains, `maxCandidatesPerRole` per role, a beam of
 * `beamWidth` partial compositions per role step, and hard caps on partial expansions and
 * scoring operations. Ordering is total (score, then identity), so identical inputs give
 * identical options; `variant` is the only, explicitly bounded, source of variation.
 */
export const COMPOSITION_BUDGET = Object.freeze({
  maxAnchors: 4,
  maxCandidatesPerRole: 6,
  beamWidth: 8,
  maxPartials: 1200,
  maxScoringOperations: 2400,
  maxOptions: 3,
  maxCatalogCandidates: 320,
});
export type CompositionBudgetLimits = typeof COMPOSITION_BUDGET;

export const SCORE_WEIGHTS = Object.freeze({
  roleCompleteness: 0.3, inventoryCoverage: 0.2, shoppingCostProxy: 0.15, preferenceFit: 0.15,
  ingredientReuse: 0.05, variety: 0.1, effort: 0.05,
});

export interface ComposerEvaluation {
  /** Satisfied share of required lines from the T02 evaluation at this slot; null when untracked. */
  coverage: number | null;
  missingIngredientIds: readonly string[];
  inventoryIngredientIds: readonly string[];
  ingredientIds: readonly string[];
  cookMinutes: number | null;
}
export interface ComposerCandidate extends ComposerEvaluation {
  key: string;
  kind: 'recipe' | 'simple_food';
  id: string;
  title: string;
  roles: readonly MealRole[];
  traits: readonly RecipeTrait[];
  dominantIngredientId: string | null;
  /** Normalized T03 utility in [0, 1]; simple foods use a neutral 0.5. */
  preference: number;
}
export interface ComposerFixed extends ComposerEvaluation {
  componentId: string;
  key: string;
  kind: 'recipe' | 'simple_food';
  id: string;
  title: string;
  role: MealRole;
  traits: readonly RecipeTrait[];
  dominantIngredientId: string | null;
  locked: boolean;
}
export interface ComposeInput {
  mealType: MealType;
  fixed: readonly ComposerFixed[];
  rolesToFill: readonly MealRole[];
  candidates: readonly ComposerCandidate[];
  variant: number;
  maxOptions: number;
  budget?: Partial<CompositionBudgetLimits>;
}
export interface ComposedItem { role: MealRole; fixed: ComposerFixed | null; candidate: ComposerCandidate | null }
export interface CompositionScore {
  total: number;
  parts: { roleCompleteness: number; inventoryCoverage: number; shoppingCostProxy: number; ingredientReuse: number;
    preferenceFit: number; variety: number; effort: number };
}
export interface ComposedOption {
  items: ComposedItem[];
  unfilledRoles: MealRole[];
  score: CompositionScore;
  explanations: Array<{ code: 'USES_INVENTORY' | 'EXTRA_INGREDIENTS' | 'ROLE_ADDED' | 'LOCKED_PRESERVED'
    | 'INGREDIENT_REUSE' | 'ROLE_UNFILLED' | 'NO_EXTRA_PURCHASES'; count: number | null; role: MealRole | null }>;
}
export interface ComposeResult {
  options: ComposedOption[];
  budget: { anchorsConsidered: number; candidatesConsidered: number; partialsExplored: number; scoringOperations: number; exhausted: boolean };
}

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
const itemKey = (item: ComposedItem) => (item.fixed ?? item.candidate)!.key;
const composable = (item: ComposedItem): ComposableItem => {
  const source = (item.fixed ?? item.candidate)!;
  return { key: source.key, kind: source.kind, id: source.id, role: item.role, traits: source.traits,
    dominantIngredientId: source.dominantIngredientId };
};

export function scoreComposition(mealType: MealType, items: readonly ComposedItem[]): CompositionScore {
  const profile = MEAL_PROFILES[mealType];
  const wanted = [...profile.required, ...profile.recommended];
  const covered = coveredRoles(items.map(composable));
  const sources = items.map((item) => (item.fixed ?? item.candidate)!);
  const tracked = sources.filter((source) => source.coverage !== null);
  const missing = new Set(sources.flatMap((source) => source.missingIngredientIds));
  const counts = new Map<string, number>();
  for (const source of sources) for (const id of new Set(source.ingredientIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const shared = [...counts.values()].filter((count) => count > 1).length;
  const added = items.filter((item) => item.candidate !== null).map((item) => item.candidate!);
  const issues = compatibilityIssues(items.map(composable));
  const minutes = sources.reduce((sum, source) => sum + (source.cookMinutes ?? 0), 0);
  const parts = {
    roleCompleteness: round(wanted.length ? wanted.filter((role) => covered.has(role)).length / wanted.length : 1),
    inventoryCoverage: round(tracked.length ? tracked.reduce((sum, source) => sum + source.coverage!, 0) / tracked.length : 1),
    shoppingCostProxy: round(1 / (1 + missing.size)),
    ingredientReuse: round(counts.size && sources.length > 1 ? shared / counts.size : 0),
    preferenceFit: round(added.length ? added.reduce((sum, source) => sum + source.preference, 0) / added.length : 1),
    variety: round(1 - (issues.includes('DOMINANT_INGREDIENT_REPEAT') ? 0.5 : 0) - (issues.includes('ALL_FRIED') ? 0.5 : 0)),
    effort: round(minutes <= profile.targetEffortMinutes ? 1 : 1 - (minutes - profile.targetEffortMinutes) / profile.targetEffortMinutes),
  };
  const total = (Object.keys(SCORE_WEIGHTS) as Array<keyof typeof SCORE_WEIGHTS>)
    .reduce((sum, key) => sum + SCORE_WEIGHTS[key] * parts[key], 0);
  return { total: round(total), parts };
}

function explain(items: readonly ComposedItem[], unfilled: readonly MealRole[]): ComposedOption['explanations'] {
  const added = items.filter((item) => item.candidate);
  const sources = items.map((item) => (item.fixed ?? item.candidate)!);
  const inventory = new Set(added.flatMap((item) => item.candidate!.inventoryIngredientIds));
  const missing = new Set(sources.flatMap((source) => source.missingIngredientIds));
  const result: ComposedOption['explanations'] = [];
  const locked = items.filter((item) => item.fixed?.locked).length;
  if (locked) result.push({ code: 'LOCKED_PRESERVED', count: locked, role: null });
  if (inventory.size) result.push({ code: 'USES_INVENTORY', count: inventory.size, role: null });
  result.push(missing.size ? { code: 'EXTRA_INGREDIENTS', count: missing.size, role: null }
    : { code: 'NO_EXTRA_PURCHASES', count: 0, role: null });
  for (const item of added) result.push({ code: 'ROLE_ADDED', count: null, role: item.role });
  for (const role of unfilled) result.push({ code: 'ROLE_UNFILLED', count: null, role });
  return result;
}

function rotate<T>(items: readonly T[], variant: number): T[] {
  if (!items.length) return [];
  const offset = variant % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

export function composeMeal(input: ComposeInput): ComposeResult {
  const limits = { ...COMPOSITION_BUDGET, ...input.budget };
  const budget = { anchorsConsidered: 0, candidatesConsidered: 0, partialsExplored: 0, scoringOperations: 0, exhausted: false };
  const fixedKeys = new Set(input.fixed.map((item) => item.key));
  const maxComponents = MEAL_PROFILES[input.mealType].maxComponents;
  const roleOrder = MEAL_ROLES.filter((role) => input.rolesToFill.includes(role));
  const fit = (candidate: ComposerCandidate) => 0.6 * (candidate.coverage ?? 0.5) + 0.4 * candidate.preference;
  const pools = new Map<MealRole, ComposerCandidate[]>();
  for (const role of roleOrder) {
    const ranked = input.candidates.filter((candidate) => candidate.roles.includes(role) && !fixedKeys.has(candidate.key))
      .sort((a, b) => fit(b) - fit(a) || compareIds(a.key, b.key));
    // Variation rotates only within the top of the ranked pool, never beyond the cap.
    const cap = role === 'main' ? limits.maxAnchors : limits.maxCandidatesPerRole;
    const pool = rotate(ranked.slice(0, cap * 2), input.variant).slice(0, cap);
    budget.candidatesConsidered += pool.length;
    pools.set(role, pool);
  }
  type Partial = { items: ComposedItem[]; unfilled: MealRole[] };
  const base: ComposedItem[] = input.fixed.map((fixed) => ({ role: fixed.role, fixed, candidate: null }));
  const scoreOf = (partial: Partial) => {
    budget.scoringOperations++;
    if (budget.scoringOperations > limits.maxScoringOperations) budget.exhausted = true;
    return scoreComposition(input.mealType, partial.items).total;
  };
  let frontier: Partial[] = [{ items: base, unfilled: [] }];
  for (const role of roleOrder) {
    if (budget.exhausted) break;
    const next: Partial[] = [];
    for (const partial of frontier) {
      if (coveredRoles(partial.items.map(composable)).has(role)) { next.push(partial); continue; }
      let extended = false;
      for (const candidate of pools.get(role) ?? []) {
        if (partial.items.length >= maxComponents) break;
        if (budget.partialsExplored >= limits.maxPartials) { budget.exhausted = true; break; }
        const items = [...partial.items, { role, fixed: null, candidate }];
        budget.partialsExplored++;
        if (role === 'main') budget.anchorsConsidered++;
        if (hasHardIssue(compatibilityIssues(items.map(composable)))) continue;
        next.push({ items, unfilled: partial.unfilled });
        extended = true;
      }
      if (!extended) next.push({ items: partial.items, unfilled: [...partial.unfilled, role] });
      if (budget.exhausted) break;
    }
    const scored = next.map((partial) => ({ partial, key: partial.items.map(itemKey).sort().join('|'), score: scoreOf(partial) }));
    const seen = new Set<string>();
    frontier = scored.sort((a, b) => b.score - a.score || compareIds(a.key, b.key))
      .filter((entry) => (seen.has(entry.key) ? false : (seen.add(entry.key), true)))
      .slice(0, limits.beamWidth).map((entry) => entry.partial);
  }
  const options = frontier.map((partial) => ({ partial, score: scoreComposition(input.mealType, partial.items),
    key: partial.items.map(itemKey).sort().join('|') }))
    .sort((a, b) => b.score.total - a.score.total || compareIds(a.key, b.key))
    .slice(0, Math.min(limits.maxOptions, input.maxOptions))
    .map(({ partial, score }) => ({ items: partial.items, unfilledRoles: [...new Set(partial.unfilled)], score,
      explanations: explain(partial.items, [...new Set(partial.unfilled)]) }));
  return { options, budget };
}
