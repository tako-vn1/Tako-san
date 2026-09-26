import type { MealRole } from '../../../domain/src/meal-composition-api';
import type { RecipeTrait } from './roles';

export type MealType = 'breakfast' | 'lunch' | 'dinner';

/**
 * Flexible per-meal-type composition profiles. `required` roles define completeness,
 * `recommended` roles are what Assisted/Auto fill, `optional` roles are only ever added by the
 * user. No universal six-dish meal.
 */
export interface MealProfile {
  required: MealRole[];
  recommended: MealRole[];
  optional: MealRole[];
  maxComponents: number;
  targetEffortMinutes: number;
}

export const MEAL_PROFILES: Readonly<Record<MealType, MealProfile>> = Object.freeze({
  breakfast: { required: ['main'], recommended: [], optional: ['simple_food', 'side', 'dessert'], maxComponents: 3, targetEffortMinutes: 30 },
  lunch: { required: ['main'], recommended: ['vegetable', 'staple'], optional: ['soup', 'side', 'dessert'], maxComponents: 4, targetEffortMinutes: 50 },
  dinner: { required: ['main', 'staple'], recommended: ['vegetable', 'soup'], optional: ['side', 'dessert'], maxComponents: 6, targetEffortMinutes: 75 },
});

export interface ComposableItem {
  key: string;
  kind: 'recipe' | 'simple_food';
  id: string;
  role: MealRole;
  traits: readonly RecipeTrait[];
  dominantIngredientId: string | null;
}

/** Roles covered by the composition, including roles implied by one-dish traits. */
export function coveredRoles(items: readonly ComposableItem[]): Set<MealRole> {
  const covered = new Set<MealRole>(items.map((item) => item.role));
  if (items.some((item) => item.role === 'main' && item.traits.includes('includes_staple'))) covered.add('staple');
  if (items.some((item) => item.role === 'main' && item.traits.includes('brothy'))) covered.add('soup');
  return covered;
}

export function missingRoles(mealType: MealType, items: readonly ComposableItem[], include: 'required' | 'recommended'): MealRole[] {
  const profile = MEAL_PROFILES[mealType];
  const covered = coveredRoles(items);
  const wanted = include === 'required' ? profile.required : [...profile.required, ...profile.recommended];
  return wanted.filter((role) => !covered.has(role));
}

/**
 * Deterministic compatibility rules. `hard` rules gate Assisted/Auto candidates; for Manual
 * compositions every rule is reported as a warning because the user decided explicitly.
 */
export const COMPATIBILITY_RULES = Object.freeze({
  DUPLICATE_ITEM: 'hard',
  MULTIPLE_MAINS: 'hard',
  MULTIPLE_SOUPS: 'hard',
  STAPLE_CONFLICT: 'hard',
  DOMINANT_INGREDIENT_REPEAT: 'soft',
  ALL_FRIED: 'soft',
} as const);
export type CompatibilityCode = keyof typeof COMPATIBILITY_RULES;

export function compatibilityIssues(items: readonly ComposableItem[]): CompatibilityCode[] {
  const issues = new Set<CompatibilityCode>();
  const identities = items.map((item) => `${item.kind}:${item.id}`);
  if (new Set(identities).size !== identities.length) issues.add('DUPLICATE_ITEM');
  if (items.filter((item) => item.role === 'main').length > 1) issues.add('MULTIPLE_MAINS');
  if (items.filter((item) => item.role === 'soup' || item.traits.includes('brothy')).length > 1) issues.add('MULTIPLE_SOUPS');
  const staples = items.filter((item) => item.role === 'staple').length;
  const implied = items.some((item) => item.role !== 'staple' && item.traits.includes('includes_staple'));
  if (staples > 1 || (staples === 1 && implied)) issues.add('STAPLE_CONFLICT');
  const dominant = items.map((item) => item.dominantIngredientId).filter((id): id is string => id !== null);
  if (new Set(dominant).size !== dominant.length) issues.add('DOMINANT_INGREDIENT_REPEAT');
  const recipes = items.filter((item) => item.kind === 'recipe');
  if (recipes.length >= 2 && recipes.every((item) => item.traits.includes('fried'))) issues.add('ALL_FRIED');
  return [...issues].sort();
}

export const hasHardIssue = (issues: readonly CompatibilityCode[]) => issues.some((code) => COMPATIBILITY_RULES[code] === 'hard');
