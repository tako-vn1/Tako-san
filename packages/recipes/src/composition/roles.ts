import { CANONICAL_INGREDIENTS } from '../../../domain/src';
import {
  MEAL_ROLES,
  type MealRole,
  type RoleSource,
} from '../../../domain/src/meal-composition-api';
import type { Recipe } from '../types';

/**
 * T20 deterministic recipe-role enrichment (ADR-031). Rules read only existing recipe metadata
 * (category, title, tags, ingredient lines, cook time). No provider call, no randomness: the same
 * recipe always yields the same assignments for a given `ROLE_RULES_VERSION`. Rule assignments
 * carry no confidence (confidence is meaningful only for inferred/AI rows).
 */
export const ROLE_RULES_VERSION = 't20-roles-v1';
/** AI-inferred rows below this confidence are never effective; they remain review queue items. */
export const AI_ROLE_MIN_CONFIDENCE = 0.8;

export type RecipeTrait = 'complete_meal' | 'includes_staple' | 'brothy' | 'fried';

export interface RoleAssignment {
  role: MealRole;
  source: RoleSource;
  decision: 'assign' | 'reject';
  confidence: number | null;
  reviewed: boolean;
  evidence: string;
}

export interface RecipeRoleProfile {
  recipeId: string;
  roles: MealRole[];
  traits: RecipeTrait[];
  assignments: RoleAssignment[];
  reviewRequired: boolean;
  reviewReasons: string[];
  /** First protein-bearing ingredient line, used for dominant-ingredient compatibility. */
  dominantIngredientId: string | null;
}

/** A persisted role row (migration 0039). Only server/operator SQL writes these; never a request. */
export interface PersistedRoleAssignment {
  recipeId: string;
  role: MealRole;
  source: RoleSource;
  decision: 'assign' | 'reject';
  confidence: number | null;
  reviewed: boolean;
}

export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const CANONICAL_CATEGORY = new Map(CANONICAL_INGREDIENTS.map((item) => [item.id, item.category]));
const PROTEIN_CATEGORIES = new Set(['meat', 'seafood', 'egg']);
const PROTEIN_WORDS = /\b(thit|ba chi|suon|bo|ga|heo|vit|ca|tom|muc|cua|ngheu|so diep|trung|dau phu|dau hu|hai san|bach tuoc|oc|xuc xich|cha|nem|lap xuong|ca hoi|tofu|chicken|beef|pork|salmon|shrimp|egg)\b/;
const NOODLE_OR_RICE = /^(pho|bun|mi|mien|hu tieu|banh canh|udon|ramen|ramyeon|soba|pad thai|com|xoi|chao|risotto|pasta|spaghetti|lasagna|banh mi|naengmyeon|japchae|bibimbap|gimbap|kimbap|mi quang|cao lau|pizza)\b/;
const BROTHY_NOODLE = /^(pho|chao|ramen|ramyeon|udon|banh canh|hu tieu|mien|bun|mi quang)\b/;
const NOT_BROTHY = /\b(xao|tron|cha|lanh|kho|y|nuong|chien)\b/;
const SOUP_TITLE = /^(canh|sup|tom yum|miso|soup)\b|\b(jjigae|guk|tang|soup|sup)\b/;
const DESSERT_TITLE = /^(che|banh flan|flan|kem|pudding|mochi|tiramisu|panna cotta|sua chua|thach|banh plan)\b/;
const SIDE_TITLE = /^(goi|nom|salad|dua|kim chi|cu cai|rau song|banh trang tron|edamame|sunomono)\b/;
const ROLL_TITLE = /^(cuon|goi cuon|nem|cha gio|bo bia)\b|\bcuon\b/;
const VEG_METHOD = /\b(xao|luoc|hap|nuong|om|tron|chien|ap chao|nau)\b/;
const HOTPOT = /^lau\b/;
const PLAIN_STAPLE = /^(com trang|com nong|xoi trang|banh mi khong|com gao lut)\b/;

function add(list: RoleAssignment[], role: MealRole, evidence: string) {
  if (!list.some((entry) => entry.role === role)) {
    list.push({ role, source: 'rule', decision: 'assign', confidence: null, reviewed: false, evidence });
  }
}

function proteinLine(recipe: Recipe): string | null {
  for (const line of recipe.ingredients) {
    if (line.isOptional) continue;
    const category = CANONICAL_CATEGORY.get(line.ingredientId);
    if ((category && PROTEIN_CATEGORIES.has(category)) || PROTEIN_WORDS.test(normalizeText(line.name))) {
      return line.ingredientId;
    }
  }
  return null;
}

/** Pure rule classification of one runtime recipe. */
export function classifyRecipeRoles(recipe: Recipe): RecipeRoleProfile {
  const title = normalizeText(recipe.title);
  const tags = recipe.tags.map(normalizeText);
  const category = recipe.category ?? null;
  const protein = proteinLine(recipe);
  const assignments: RoleAssignment[] = [];
  const traits = new Set<RecipeTrait>();
  const required = recipe.ingredients.filter((line) => !line.isOptional).length;
  if (/\b(chien|ran|tempura|karaage|tonkatsu)\b/.test(title) || category === 'mon_chien') traits.add('fried');

  if (DESSERT_TITLE.test(title) || tags.some((tag) => tag === 'trang mieng' || tag === 'mon ngot')) {
    add(assignments, 'dessert', 'title_or_tag:dessert');
  } else if (PLAIN_STAPLE.test(title)) {
    add(assignments, 'staple', 'title:plain_staple');
    add(assignments, 'simple_food', 'title:plain_staple');
  } else if (HOTPOT.test(title) || category === 'mon_lau_tiec') {
    add(assignments, 'main', 'category_or_title:hotpot');
    traits.add('complete_meal'); traits.add('brothy');
  } else if (category === 'mon_canh' || SOUP_TITLE.test(title) || tags.some((tag) => tag === 'mon canh' || tag === 'canh' || tag === 'sup')) {
    add(assignments, 'soup', category === 'mon_canh' ? 'category:mon_canh' : 'title_or_tag:soup');
    traits.add('brothy');
  } else if (NOODLE_OR_RICE.test(title) || category === 'mon_bun_pho') {
    add(assignments, 'main', category === 'mon_bun_pho' ? 'category:mon_bun_pho' : 'title:one_dish_staple');
    traits.add('complete_meal'); traits.add('includes_staple');
    if (BROTHY_NOODLE.test(title) && !NOT_BROTHY.test(title)) traits.add('brothy');
  } else if (SIDE_TITLE.test(title) || tags.some((tag) => tag === 'khai vi' || tag === 'mon phu' || tag === 'mon lanh')
    || (category === 'mon_cuon_nom' && !ROLL_TITLE.test(title))) {
    add(assignments, 'side', 'title_or_tag:side');
    if (!protein) add(assignments, 'vegetable', 'side_without_protein');
  } else if (ROLL_TITLE.test(title) || category === 'mon_cuon_nom') {
    add(assignments, 'side', 'title_or_category:roll');
    if (protein) add(assignments, 'main', 'roll_with_protein');
  } else if (!protein && VEG_METHOD.test(title)) {
    add(assignments, 'vegetable', 'no_protein:vegetable_method');
    add(assignments, 'side', 'no_protein:vegetable_method');
  } else if (protein) {
    add(assignments, 'main', category ? `category:${category}` : 'protein_ingredient');
    if (/\btrung\b/.test(title) && required <= 4) add(assignments, 'side', 'simple_egg_dish');
  } else if (category === 'mon_nhanh_sang' || category === 'mon_chay') {
    add(assignments, 'main', `category:${category}`);
  }
  if (assignments.length > 0 && required <= 3 && recipe.cookTimeMinutes <= 15
    && !assignments.some((entry) => entry.role === 'soup' || entry.role === 'dessert')) {
    add(assignments, 'simple_food', 'few_ingredients_quick');
  }
  const reviewReasons: string[] = [];
  if (assignments.length === 0) {
    add(assignments, 'main', 'fallback:no_rule_matched');
    reviewReasons.push('FALLBACK_ROLE');
  }
  return {
    recipeId: recipe.id,
    roles: orderRoles(assignments.map((entry) => entry.role)),
    traits: [...traits].sort(),
    assignments,
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    dominantIngredientId: protein,
  };
}

export function orderRoles(roles: readonly MealRole[]): MealRole[] {
  return MEAL_ROLES.filter((role) => roles.includes(role));
}

/**
 * Merges persisted assignments over rule output. Human-reviewed rows are authoritative for the
 * recipe when present; otherwise reviewed rejections remove a role, AI rows need confidence ≥
 * `AI_ROLE_MIN_CONFIDENCE`, and every other source is additive.
 */
export function resolveRecipeRoles(rule: RecipeRoleProfile,
  persisted: readonly PersistedRoleAssignment[]): RecipeRoleProfile {
  const rows = persisted.filter((row) => row.recipeId === rule.recipeId);
  if (!rows.length) return rule;
  const toAssignment = (row: PersistedRoleAssignment): RoleAssignment => ({
    role: row.role, source: row.source, decision: row.decision, confidence: row.confidence,
    reviewed: row.reviewed, evidence: `persisted:${row.source}`,
  });
  const reviewedAssign = rows.filter((row) => row.reviewed && row.decision === 'assign');
  const rejected = new Set(rows.filter((row) => row.reviewed && row.decision === 'reject').map((row) => row.role));
  const reviewReasons: string[] = [];
  let effective: RoleAssignment[];
  if (reviewedAssign.length) {
    effective = reviewedAssign.map(toAssignment);
  } else {
    const inferred = rows.filter((row) => !row.reviewed && row.decision === 'assign');
    const lowConfidence = inferred.filter((row) => row.source === 'ai' && (row.confidence ?? 0) < AI_ROLE_MIN_CONFIDENCE);
    if (lowConfidence.length) reviewReasons.push('LOW_CONFIDENCE_AI_ROLE');
    effective = [...rule.assignments, ...inferred.filter((row) => !lowConfidence.includes(row)).map(toAssignment)]
      .filter((entry) => !rejected.has(entry.role));
  }
  const unique: RoleAssignment[] = [];
  for (const entry of effective) if (!unique.some((item) => item.role === entry.role)) unique.push(entry);
  const hasReviewed = reviewedAssign.length > 0;
  if (!hasReviewed && rule.reviewRequired) reviewReasons.push(...rule.reviewReasons);
  if (!unique.length) reviewReasons.push('NO_EFFECTIVE_ROLE');
  return {
    ...rule,
    roles: orderRoles(unique.map((entry) => entry.role)),
    assignments: unique,
    reviewRequired: reviewReasons.length > 0,
    reviewReasons: [...new Set(reviewReasons)].sort(),
  };
}

export interface RoleIndex {
  get(recipeId: string): RecipeRoleProfile | undefined;
  readonly profiles: readonly RecipeRoleProfile[];
}

/** Builds role profiles for exactly the authority-visible recipes (never a wider universe). */
export function buildRoleIndex(recipes: readonly Recipe[], persisted: readonly PersistedRoleAssignment[] = []): RoleIndex {
  const visible = new Set(recipes.map((recipe) => recipe.id));
  const fenced = persisted.filter((row) => visible.has(row.recipeId));
  const profiles = recipes.map((recipe) => resolveRecipeRoles(classifyRecipeRoles(recipe), fenced))
    .sort((a, b) => (a.recipeId < b.recipeId ? -1 : a.recipeId > b.recipeId ? 1 : 0));
  const byId = new Map(profiles.map((profile) => [profile.recipeId, profile]));
  return { get: (recipeId) => byId.get(recipeId), profiles };
}

export interface RoleDistributionAudit {
  recipeCount: number;
  byRole: Record<MealRole, number>;
  unclassified: string[];
  reviewRequired: string[];
  invalidRoles: string[];
  duplicateAssignments: string[];
  contradictions: string[];
}

/** Catalog-wide role audit used by tests and the review report. */
export function auditRoleDistribution(index: RoleIndex): RoleDistributionAudit {
  const byRole = Object.fromEntries(MEAL_ROLES.map((role) => [role, 0])) as Record<MealRole, number>;
  const audit: RoleDistributionAudit = { recipeCount: index.profiles.length, byRole, unclassified: [],
    reviewRequired: [], invalidRoles: [], duplicateAssignments: [], contradictions: [] };
  for (const profile of index.profiles) {
    for (const role of profile.roles) {
      if ((MEAL_ROLES as readonly string[]).includes(role)) byRole[role]++;
      else audit.invalidRoles.push(profile.recipeId);
    }
    if (!profile.roles.length) audit.unclassified.push(profile.recipeId);
    if (profile.reviewRequired) audit.reviewRequired.push(profile.recipeId);
    if (new Set(profile.assignments.map((entry) => entry.role)).size !== profile.assignments.length) {
      audit.duplicateAssignments.push(profile.recipeId);
    }
    const roles = new Set(profile.roles);
    if ((roles.has('dessert') && (roles.has('main') || roles.has('soup')))
      || (roles.has('soup') && roles.has('staple'))) audit.contradictions.push(profile.recipeId);
  }
  return audit;
}
