import { z } from 'zod';
import { CatalogIdSchema } from './foundation';
import { PlanIdSchema, PlanRevisionSchema } from './meal-planning-api';

/**
 * T20 Meal Composition V2 — frontend-safe contracts. A meal slot holds one composition of ordered
 * components. The server resolves recipe authority, roles, inventory and scoring; requests carry
 * only identities and explicit user intent (ADR-031).
 */
export const MEAL_ROLES = ['main', 'side', 'vegetable', 'soup', 'staple', 'dessert', 'simple_food'] as const;
export const MealRoleSchema = z.enum(MEAL_ROLES);
export type MealRole = z.infer<typeof MealRoleSchema>;

export const ComponentKindSchema = z.enum(['recipe', 'simple_food']);
export const ComponentProvenanceSchema = z.enum(['legacy_v1', 'manual', 'assisted', 'auto']);
export type ComponentProvenance = z.infer<typeof ComponentProvenanceSchema>;
export const CompositionModeSchema = z.enum(['manual', 'assisted', 'auto']);
export type CompositionMode = z.infer<typeof CompositionModeSchema>;
export const RoleSourceSchema = z.enum(['reviewed', 'imported', 'rule', 'ai', 'legacy']);
export type RoleSource = z.infer<typeof RoleSourceSchema>;

export const MAX_COMPONENTS_PER_MEAL = 8;
export const MAX_COMPOSITION_VARIANT = 9;
export const PICKER_PAGE_LIMIT = 24;

export const ComponentIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const SimpleFoodIdSchema = z.string().regex(/^sf-[a-z0-9-]{1,60}$/);
export const CompositionSlotIdSchema = z.string().max(64)
  .regex(/^\d{4}-\d{2}-\d{2}:(breakfast|lunch|dinner):\d{1,2}$/);
const MealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner']);
const Code = z.string().min(1).max(80);
const HexId = z.string().regex(/^[0-9a-f]{32}$/);

export const ComponentTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recipe'), recipeId: CatalogIdSchema }).strict(),
  z.object({ kind: z.literal('simple_food'), simpleFoodId: SimpleFoodIdSchema }).strict(),
]);
export type ComponentTarget = z.infer<typeof ComponentTargetSchema>;

// ---------------------------------------------------------------------------- requests
export const AddComponentSchema = z.object({
  revision: PlanRevisionSchema,
  target: ComponentTargetSchema,
  role: MealRoleSchema,
  // User-chosen components are protected from Assisted/Auto regeneration unless explicitly unlocked.
  locked: z.boolean().default(true),
}).strict();
export const SwapComponentSchema = z.object({
  revision: PlanRevisionSchema,
  target: ComponentTargetSchema,
  role: MealRoleSchema.optional(),
}).strict();
export const UpdateComponentSchema = z.object({
  revision: PlanRevisionSchema,
  locked: z.boolean().optional(),
  role: MealRoleSchema.optional(),
  ordinal: z.number().int().min(0).max(MAX_COMPONENTS_PER_MEAL - 1).optional(),
}).strict().refine((value) => value.locked !== undefined || value.role !== undefined || value.ordinal !== undefined,
  'At least one change is required');
export const RemoveComponentQuerySchema = z.object({ revision: z.string().regex(/^[1-9]\d{0,14}$/) }).strict();
export const ReplaceCompositionSchema = z.object({
  revision: PlanRevisionSchema,
  components: z.array(z.object({
    id: ComponentIdSchema.optional(),
    target: ComponentTargetSchema,
    role: MealRoleSchema,
    locked: z.boolean(),
  }).strict()).max(MAX_COMPONENTS_PER_MEAL),
}).strict();
export const AssistActionSchema = z.enum(['complete', 'regenerate_unlocked']);
export const AssistRequestSchema = z.object({
  revision: PlanRevisionSchema,
  action: AssistActionSchema,
  variant: z.number().int().min(0).max(MAX_COMPOSITION_VARIANT).default(0),
}).strict();
export const AssistApplySchema = z.object({
  revision: PlanRevisionSchema,
  action: AssistActionSchema,
  variant: z.number().int().min(0).max(MAX_COMPOSITION_VARIANT).default(0),
  proposalId: HexId,
}).strict();
export const AutoRequestSchema = z.object({
  revision: PlanRevisionSchema,
  variant: z.number().int().min(0).max(MAX_COMPOSITION_VARIANT).default(0),
}).strict();
export const AutoApplySchema = z.object({
  revision: PlanRevisionSchema,
  variant: z.number().int().min(0).max(MAX_COMPOSITION_VARIANT).default(0),
  optionId: HexId,
}).strict();
export const PickerQuerySchema = z.object({
  role: MealRoleSchema.optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().regex(/^[0-9]{1,4}$/).optional(),
  limit: z.string().regex(/^[1-9][0-9]?$/).optional(),
  kind: ComponentKindSchema.optional(),
}).strict();

// ---------------------------------------------------------------------------- responses
export const ComponentProjectionSchema = z.object({
  status: z.enum(['covered', 'needs_shopping', 'unresolved', 'not_tracked', 'unavailable']),
  missingCount: z.number().int().nonnegative(),
  inventoryLineCount: z.number().int().nonnegative(),
}).strict();
export const MealComponentDtoSchema = z.object({
  id: ComponentIdSchema,
  kind: ComponentKindSchema,
  role: MealRoleSchema,
  ordinal: z.number().int().nonnegative(),
  locked: z.boolean(),
  provenance: ComponentProvenanceSchema,
  recipeId: CatalogIdSchema.nullable(),
  simpleFoodId: SimpleFoodIdSchema.nullable(),
  title: z.string(),
  permittedRoles: z.array(MealRoleSchema),
  /** Recipe-backed and resolvable under the current recipe authority: detail and cooking work. */
  cookable: z.boolean(),
  resolvable: z.boolean(),
  cookTimeMinutes: z.number().nonnegative().nullable(),
  createdRevision: PlanRevisionSchema,
  updatedRevision: PlanRevisionSchema,
  projection: ComponentProjectionSchema.nullable(),
}).strict();
export type MealComponentDto = z.infer<typeof MealComponentDtoSchema>;

export const MealCompositionDtoSchema = z.object({
  slotId: CompositionSlotIdSchema,
  date: z.string().date(),
  mealType: MealTypeSchema,
  servings: z.number().int().positive(),
  /** `v1_projection`: an unedited V1 slot read as a one-component composition; `v2`: stored components. */
  source: z.enum(['v1_projection', 'v2']),
  mode: CompositionModeSchema.nullable(),
  components: z.array(MealComponentDtoSchema).max(MAX_COMPONENTS_PER_MEAL),
  missingRoles: z.array(MealRoleSchema),
  recommendedRoles: z.array(MealRoleSchema),
  warnings: z.array(Code),
}).strict();
export type MealCompositionDto = z.infer<typeof MealCompositionDtoSchema>;

export const PlanCompositionsDtoSchema = z.object({
  schemaVersion: z.literal(1),
  planId: PlanIdSchema,
  planRevision: PlanRevisionSchema,
  compositions: z.array(MealCompositionDtoSchema),
}).strict();
export type PlanCompositionsDto = z.infer<typeof PlanCompositionsDtoSchema>;

export const SlotCompositionDtoSchema = z.object({
  schemaVersion: z.literal(1),
  planId: PlanIdSchema,
  planRevision: PlanRevisionSchema,
  composition: MealCompositionDtoSchema,
}).strict();
export type SlotCompositionDto = z.infer<typeof SlotCompositionDtoSchema>;

export const CompositionExplanationSchema = z.object({
  code: z.enum(['USES_INVENTORY', 'EXTRA_INGREDIENTS', 'ROLE_ADDED', 'LOCKED_PRESERVED',
    'INGREDIENT_REUSE', 'ROLE_UNFILLED', 'NO_EXTRA_PURCHASES']),
  count: z.number().int().nonnegative().nullable(),
  role: MealRoleSchema.nullable(),
}).strict();
export const CompositionScoreSchema = z.object({
  total: z.number().min(0).max(1),
  parts: z.object({
    roleCompleteness: z.number().min(0).max(1),
    inventoryCoverage: z.number().min(0).max(1),
    shoppingCostProxy: z.number().min(0).max(1),
    ingredientReuse: z.number().min(0).max(1),
    preferenceFit: z.number().min(0).max(1),
    variety: z.number().min(0).max(1),
    effort: z.number().min(0).max(1),
  }).strict(),
}).strict();
export const ProposedComponentSchema = z.object({
  kind: ComponentKindSchema,
  role: MealRoleSchema,
  recipeId: CatalogIdSchema.nullable(),
  simpleFoodId: SimpleFoodIdSchema.nullable(),
  title: z.string(),
  locked: z.boolean(),
  /** Existing component retained by the proposal; null for an addition. */
  existingComponentId: ComponentIdSchema.nullable(),
}).strict();
export const CompositionBudgetSchema = z.object({
  anchorsConsidered: z.number().int().nonnegative(),
  candidatesConsidered: z.number().int().nonnegative(),
  partialsExplored: z.number().int().nonnegative(),
  scoringOperations: z.number().int().nonnegative(),
  exhausted: z.boolean(),
}).strict();
export const CompositionOptionSchema = z.object({
  optionId: HexId,
  components: z.array(ProposedComponentSchema).max(MAX_COMPONENTS_PER_MEAL),
  removedComponentIds: z.array(ComponentIdSchema),
  unfilledRoles: z.array(MealRoleSchema),
  score: CompositionScoreSchema,
  explanations: z.array(CompositionExplanationSchema),
}).strict();
export const AssistProposalDtoSchema = z.object({
  schemaVersion: z.literal(1),
  planId: PlanIdSchema,
  planRevision: PlanRevisionSchema,
  slotId: CompositionSlotIdSchema,
  action: AssistActionSchema,
  variant: z.number().int().min(0).max(MAX_COMPOSITION_VARIANT),
  proposal: CompositionOptionSchema.nullable(),
  budget: CompositionBudgetSchema,
}).strict();
export type AssistProposalDto = z.infer<typeof AssistProposalDtoSchema>;
export const AutoOptionsDtoSchema = z.object({
  schemaVersion: z.literal(1),
  planId: PlanIdSchema,
  planRevision: PlanRevisionSchema,
  slotId: CompositionSlotIdSchema,
  variant: z.number().int().min(0).max(MAX_COMPOSITION_VARIANT),
  options: z.array(CompositionOptionSchema).max(3),
  budget: CompositionBudgetSchema,
}).strict();
export type AutoOptionsDto = z.infer<typeof AutoOptionsDtoSchema>;
export type CompositionOptionDto = z.infer<typeof CompositionOptionSchema>;

export const PickerItemSchema = z.object({
  kind: ComponentKindSchema,
  id: z.string().min(1).max(200),
  title: z.string(),
  roles: z.array(MealRoleSchema),
  cuisine: z.string().nullable(),
  cookTimeMinutes: z.number().nonnegative().nullable(),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable(),
  /** `unknown`: a requested allergen/dietary constraint has no reviewed safety evidence. */
  constraintState: z.enum(['none_requested', 'unknown']),
}).strict();
export const PickerPageDtoSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(PickerItemSchema).max(PICKER_PAGE_LIMIT),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
}).strict();
export type PickerPageDto = z.infer<typeof PickerPageDtoSchema>;
export type PickerItemDto = z.infer<typeof PickerItemSchema>;
