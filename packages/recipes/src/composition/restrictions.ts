import { generateRecipeCandidates } from '../candidates';
import type { RecipeDefinition } from '../foundation';
import { resolveRankingPreferences } from '../personalization';
import { readPlanningContext, type PlanningContext } from '../planner-context';
import type { ProjectedInventoryRow } from '../planner-inventory';
import {
  candidateRestrictionFacts,
  evaluateHardRestrictions,
  type HardRestrictionFacts,
  type HardRestrictionReason,
} from '../ranking-eligibility';
import { createRankingEvidenceSnapshot, nutritionFacts, readRankingEvidenceSnapshot } from '../ranking-evidence';
import type { SimpleFood } from './simple-foods';

/**
 * T20 component hard restrictions. Every path that can put a component into a meal (Manual add /
 * swap / replace, Assisted, Auto) is judged by T03 `evaluateHardRestrictions` over the same trusted
 * planning context (T02 candidate with the planner's substitution policy, server evidence
 * provider, household hard policies). There is no second definition and no manual override.
 */
export interface RestrictionVerdict { allowed: boolean; reasons: HardRestrictionReason[] }

export type HardPolicies = ReturnType<typeof resolveRankingPreferences>['hard'];

function verdict(facts: HardRestrictionFacts, policies: HardPolicies): RestrictionVerdict {
  const reasons = [...evaluateHardRestrictions(facts, policies).reasons].sort();
  return { allowed: reasons.length === 0, reasons };
}

/**
 * A simple food has no reviewed safety or nutrition evidence, so any requested allergen/dietary
 * constraint or hard nutrition target is unknown and excludes it. Its declared `prepMinutes` is the
 * whole preparation time. Only the tracked portion ingredient is known for forbidden ingredients.
 */
export function simpleFoodRestrictions(food: SimpleFood, policies: HardPolicies): RestrictionVerdict {
  return verdict({ ingredientIds: food.portion ? [food.portion.ingredientId] : [], recipeId: null, allergenTags: [],
    evidence: undefined, totalMinutes: food.prepMinutes, nutrition: nutritionFacts(undefined) }, policies);
}

/** Recipe verdict from the T02 candidate at this slot's projected inventory, exactly as Auto ranks it. */
export function recipeRestrictions(input: {
  context: PlanningContext;
  recipe: RecipeDefinition;
  slot: { date: string; servings: number };
  inventory: readonly ProjectedInventoryRow[];
}): RestrictionVerdict {
  const source = readPlanningContext(input.context);
  const policies = resolveRankingPreferences(source.rankingContext).hard;
  const generation = generateRecipeCandidates({
    catalog: { ...source.catalog, recipes: [input.recipe], families: [] },
    inventory: input.inventory.map((row) => ({ ...row, freshness: row.freshness ?? undefined })),
    householdId: source.rankingContext.householdId, asOfDate: input.slot.date, requestedServings: input.slot.servings,
    mode: 'shopping_allowed', allocationPolicy: 'expiry_first', substitutions: source.substitutions,
    approvedSubstitutionIds: source.approvedSubstitutionIds, activeConstraints: source.activeConstraints,
  });
  const candidate = generation.candidates.find((item) => item.source.kind === 'recipe' && item.source.sourceId === input.recipe.id);
  if (candidate) {
    const evidence = source.evidenceProvider
      ? readRankingEvidenceSnapshot(createRankingEvidenceSnapshot(generation, source.evidenceProvider), generation).get(candidate.id)
      : undefined;
    return verdict(candidateRestrictionFacts(candidate, evidence, nutritionFacts(evidence)), policies);
  }
  // No T02 candidate (e.g. unresolvable line): judge the definition with no evidence, so every
  // requested safety/nutrition constraint is unknown and every scoped substitute counts.
  const substitutes = source.substitutions.filter((rule) => rule.scopeType === 'recipe' && rule.scopeId === input.recipe.id)
    .map((rule) => rule.toIngredientId);
  const { cookTimeMinutes: cook, prepTimeMinutes: prep } = input.recipe;
  return verdict({
    ingredientIds: [...new Set([...input.recipe.ingredients.map((line) => line.ingredientId), ...substitutes])],
    recipeId: input.recipe.id,
    allergenTags: source.catalog.classifications.filter((fact) => fact.recipeId === input.recipe.id && fact.kind === 'allergen')
      .map((fact) => fact.tag),
    evidence: undefined, totalMinutes: cook !== undefined && prep !== undefined ? cook + prep : null,
    nutrition: nutritionFacts(undefined),
  }, policies);
}
