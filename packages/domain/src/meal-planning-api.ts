import { z } from 'zod';
import { CatalogIdSchema } from './foundation';
import { ExactQuantityDtoSchema, MoneyDtoSchema, ShoppingResultDtoSchema } from './meal-shopping-api';

export const PlanIdSchema = z.string().uuid();
export const PlanRevisionSchema = z.number().int().positive().safe();
export const PlanningRequestKeySchema = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
const MealType = z.enum(['breakfast', 'lunch', 'dinner']);
const Servings = z.number().int().min(1).max(20);
const SlotId = z.string().max(64).regex(/^\d{4}-\d{2}-\d{2}:(breakfast|lunch|dinner):\d{1,2}$/);
const Code = z.string().min(1).max(200);
const Instant = z.string().datetime({ offset: true });

export const MealPlanningIntentSchema = z.object({
  startDate: z.string().date(),
  horizonDays: z.number().int().min(1).max(14).default(7),
  utcOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  defaultServings: Servings,
  mode: z.enum(['cook_now', 'shopping_allowed']).default('cook_now'),
  slots: z.array(z.object({
    date: z.string().date(),
    mealType: MealType,
    sequence: z.number().int().min(0).max(42).default(0),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    servings: Servings.optional(),
    preferredTimeMinutes: z.number().int().min(1).max(1440).optional(),
    hardMaxTimeMinutes: z.number().int().min(1).max(1440).optional(),
  }).strict()).min(1).max(42),
}).strict();
export type MealPlanningIntent = z.infer<typeof MealPlanningIntentSchema>;

export const RegenerateMealPlanSchema = z.object({
  revision: PlanRevisionSchema,
  intent: MealPlanningIntentSchema.optional(),
}).strict();
export const SwapMealSchema = z.object({
  revision: PlanRevisionSchema,
  slotId: SlotId,
  replacement: z.object({
    kind: z.enum(['recipe', 'family']),
    id: CatalogIdSchema,
    variantId: z.string().min(1).max(20_000).optional(),
  }).strict().refine((value) => (value.kind === 'family') === (value.variantId !== undefined),
    'Only family replacements require an exact variant'),
}).strict();

export const OptimizePlanShoppingSchema = z.object({
  revision: PlanRevisionSchema,
  currency: z.enum(['VND', 'JPY', 'USD', 'EUR']),
  budget: z.object({
    mode: z.enum(['hard', 'soft']),
    money: MoneyDtoSchema,
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.budget || !MoneyDtoSchema.safeParse(value.budget.money).success) return;
  if (value.budget.money.currency !== value.currency ||
    BigInt(value.budget.money.minorAmount) > BigInt(Number.MAX_SAFE_INTEGER)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Budget currency or supported minor-unit range is invalid' });
  }
});
export const PlanFeedbackSchema = z.object({
  revision: PlanRevisionSchema,
  slotId: SlotId,
  type: z.enum(['liked', 'disliked', 'cooked', 'skipped', 'swapped']),
}).strict();

export const PlannerStatusSchema = z.enum(['feasible', 'partial', 'infeasible', 'search_limited', 'incomplete']);
export const PlannerConclusionSchema = z.enum(['feasible', 'proven_infeasible', 'no_plan_found_without_proof']);
export const PlanSourceIdentitySchema = z.object({
  kind: z.enum(['recipe', 'family']),
  id: CatalogIdSchema,
  version: PlanRevisionSchema,
  variantId: z.string().max(20_000).nullable(),
}).strict();
const RequirementDtoSchema = z.object({
  ingredientId: CatalogIdSchema,
  optional: z.boolean(),
  status: z.enum(['satisfied', 'partial', 'missing', 'unresolved']),
  required: ExactQuantityDtoSchema,
  covered: ExactQuantityDtoSchema,
  missing: ExactQuantityDtoSchema.nullable(),
  reasons: z.array(Code),
}).strict();
export const PlannedMealDtoSchema = z.object({
  slotId: SlotId,
  date: z.string().date(),
  mealType: MealType,
  time: z.string(),
  instant: Instant,
  servings: Servings,
  candidateId: z.string().min(1).max(24_000),
  source: PlanSourceIdentitySchema,
  title: z.string(),
  cuisine: z.string().nullable(),
  prepTimeMinutes: z.number().nonnegative().nullable(),
  cookTimeMinutes: z.number().nonnegative().nullable(),
  instructions: z.array(z.string()),
  requirements: z.array(RequirementDtoSchema),
  reasons: z.array(Code),
  safetyAssessment: z.enum(['not_requested', 'requested_constraints_only']),
  projectedConsumption: z.array(z.object({
    lotId: z.string(),
    ingredientId: z.string(),
    consumed: ExactQuantityDtoSchema,
    remaining: ExactQuantityDtoSchema,
  }).strict()),
}).strict();
export type PlannedMealDto = z.infer<typeof PlannedMealDtoSchema>;

export const PlanningFreshnessSchema = z.object({
  status: z.enum(['fresh', 'requires_revalidation']),
  reasons: z.array(z.enum(['stale_inventory', 'stale_preferences', 'stale_catalog', 'stale_history', 'catalog_authority_changed', 'planning_time_elapsed'])),
  checkedAt: Instant,
  requiresRevalidationBeforeConsumption: z.literal(true),
}).strict();
export const PlanResultDtoSchema = z.object({
  status: PlannerStatusSchema,
  conclusion: PlannerConclusionSchema,
  planningReference: z.object({ instant: Instant, localDate: z.string().date(), utcOffsetMinutes: z.number().int() }).strict(),
  meals: z.array(PlannedMealDtoSchema),
  unplannedSlots: z.array(z.object({ slotId: SlotId, date: z.string().date(), mealType: MealType, reasons: z.array(Code) }).strict()),
  search: z.object({
    exhaustive: z.boolean(),
    plannerExhaustive: z.boolean(),
    recipeExhaustive: z.boolean(),
    truncated: z.boolean(),
    limitReasons: z.array(Code),
    incompleteReasons: z.array(z.object({ source: Code, code: Code }).strict()),
    rejections: z.array(z.object({ slotId: SlotId.nullable(), code: Code, count: z.number().int().nonnegative() }).strict()),
  }).strict(),
  diagnostics: z.array(z.object({ slotId: SlotId.nullable(), code: Code, count: z.number().int().nonnegative() }).strict()),
}).strict();
export const MealPlanDtoSchema = z.object({
  schemaVersion: z.literal(1),
  id: PlanIdSchema,
  householdId: CatalogIdSchema,
  revision: PlanRevisionSchema,
  createdAt: Instant,
  updatedAt: Instant,
  intent: MealPlanningIntentSchema,
  result: PlanResultDtoSchema,
  freshness: PlanningFreshnessSchema,
}).strict();
export type MealPlanDto = z.infer<typeof MealPlanDtoSchema>;
export type PlanResultDto = z.infer<typeof PlanResultDtoSchema>;

export const PlanShoppingDtoSchema = z.object({
  schemaVersion: z.literal(1),
  planId: PlanIdSchema,
  planRevision: PlanRevisionSchema,
  priceAsOf: Instant,
  requiresPriceRevalidation: z.literal(true),
  catalogStatus: z.enum(['available', 'reviewed_catalog_unavailable']),
  result: ShoppingResultDtoSchema,
}).strict();
export const PlanFeedbackDtoSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  planId: PlanIdSchema,
  planRevision: PlanRevisionSchema,
  slotId: SlotId,
  type: z.enum(['liked', 'disliked', 'cooked', 'skipped', 'swapped']),
  occurredAt: Instant,
  inventoryMutated: z.literal(false),
}).strict();
