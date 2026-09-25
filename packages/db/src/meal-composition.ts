import { z } from 'zod';
import { CatalogIdSchema } from '../../domain/src/foundation';
import {
  ComponentIdSchema,
  ComponentProvenanceSchema,
  CompositionModeSchema,
  MAX_COMPONENTS_PER_MEAL,
  MealRoleSchema,
  RoleSourceSchema,
  SimpleFoodIdSchema,
  type CompositionMode,
} from '../../domain/src/meal-composition-api';
import type { MealComponent } from '../../recipes/src/composition/model';
import type { PersistedRoleAssignment } from '../../recipes/src/composition/roles';
import type { D1DatabaseBinding, D1PreparedStatement } from './index';
import {
  canonicalGeneratedMealPlanPayload,
  getGeneratedMealPlan,
  GeneratedMealPlanPersistenceError,
  mapGeneratedMealPlanRow,
  type GeneratedMealPlanRecord,
} from './meal-planning';

/**
 * T20 composition persistence (migration 0039). Every write is ONE D1 batch: a membership +
 * expected-revision fence, the plan revision bump (optionally with a V1 payload update) and the
 * full replacement of each affected slot's composition. The fence aborts the whole batch on a
 * stale revision, so a concurrent or retried stale request can never overwrite newer intent.
 */
const ScopeSchema = z.object({ householdId: CatalogIdSchema, userId: CatalogIdSchema }).strict();
type Scope = z.infer<typeof ScopeSchema>;
const RevisionSchema = z.number().int().safe().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const SlotIdSchema = z.string().min(1).max(64);
const TimestampSchema = z.string().datetime({ offset: true });

const CompositionRowSchema = z.object({
  plan_id: CatalogIdSchema,
  slot_id: SlotIdSchema,
  mode: CompositionModeSchema,
  created_revision: z.number().int().min(1),
  updated_revision: z.number().int().min(1),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();
const ComponentRowSchema = z.object({
  plan_id: CatalogIdSchema,
  id: ComponentIdSchema,
  slot_id: SlotIdSchema,
  ordinal: z.number().int().min(0).max(MAX_COMPONENTS_PER_MEAL - 1),
  kind: z.enum(['recipe', 'simple_food']),
  role: MealRoleSchema,
  recipe_id: CatalogIdSchema.nullable(),
  simple_food_id: SimpleFoodIdSchema.nullable(),
  locked: z.union([z.literal(0), z.literal(1)]),
  provenance: ComponentProvenanceSchema,
  created_revision: z.number().int().min(1),
  updated_revision: z.number().int().min(1),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();
const RoleRowSchema = z.object({
  recipe_id: CatalogIdSchema,
  role: MealRoleSchema,
  source: RoleSourceSchema,
  decision: z.enum(['assign', 'reject']),
  confidence: z.number().min(0).max(1).nullable(),
  reviewed: z.union([z.literal(0), z.literal(1)]),
}).strict();

export interface StoredComposition {
  slotId: string;
  mode: CompositionMode;
  createdRevision: number;
  updatedRevision: number;
  createdAt: string;
  components: MealComponent[];
}

export interface CompositionSlotWrite {
  slotId: string;
  mode: CompositionMode;
  createdRevision: number;
  createdAt: string | null;
  components: readonly MealComponent[];
}

export interface WritePlanCompositionsInput {
  planId: string;
  expectedRevision: number;
  /** Present only when a V1 operation (regenerate) also replaces the generation record. */
  planUpdate?: { intentJson: string; resultJson: string; sourceJson: string };
  slots: readonly CompositionSlotWrite[];
  /** Compositions of slots that no longer exist in the plan intent (V1 regenerate with a new intent). */
  deleteSlotIds?: readonly string[];
}

const OWNED_PLAN = `SELECT 1 FROM generated_meal_plans plan
  JOIN household_members member ON member.household_id = plan.household_id AND member.user_id = plan.creator_user_id
  WHERE plan.id = ? AND plan.household_id = ? AND plan.creator_user_id = ?`;

async function all(db: D1DatabaseBinding, statement: D1PreparedStatement, label: string): Promise<unknown[]> {
  const result = await statement.all<unknown>();
  if (!result.success || !Array.isArray(result.results)) throw new Error(`Meal composition ${label} read failed`);
  return result.results;
}

/** Reads every stored composition of one owned plan in one batch (plan ownership is in both queries). */
export async function readPlanCompositions(db: D1DatabaseBinding, rawScope: unknown, rawPlanId: unknown): Promise<Map<string, StoredComposition>> {
  const scope = ScopeSchema.parse(rawScope);
  const planId = CatalogIdSchema.parse(rawPlanId);
  const bindings = [planId, planId, scope.householdId, scope.userId];
  const [compositionResult, componentResult] = await db.batch<unknown>([
    db.prepare(`SELECT composition.plan_id, composition.slot_id, composition.mode, composition.created_revision,
        composition.updated_revision, composition.created_at, composition.updated_at
      FROM generated_meal_plan_compositions composition
      WHERE composition.plan_id = ? AND EXISTS (${OWNED_PLAN})
      ORDER BY composition.slot_id`).bind(...bindings),
    db.prepare(`SELECT component.plan_id, component.id, component.slot_id, component.ordinal, component.kind, component.role,
        component.recipe_id, component.simple_food_id, component.locked, component.provenance, component.created_revision,
        component.updated_revision, component.created_at, component.updated_at
      FROM generated_meal_plan_components component
      WHERE component.plan_id = ? AND EXISTS (${OWNED_PLAN})
      ORDER BY component.slot_id, component.ordinal`).bind(...bindings),
  ]);
  if (!compositionResult?.success || !componentResult?.success) throw new Error('Meal composition read failed');
  const compositions = new Map<string, StoredComposition>();
  for (const raw of compositionResult.results) {
    const row = CompositionRowSchema.parse(raw);
    compositions.set(row.slot_id, { slotId: row.slot_id, mode: row.mode, createdRevision: row.created_revision,
      updatedRevision: row.updated_revision, createdAt: row.created_at, components: [] });
  }
  for (const raw of componentResult.results) {
    const row = ComponentRowSchema.parse(raw);
    const composition = compositions.get(row.slot_id);
    if (!composition) throw new Error('Meal component has no composition');
    composition.components.push({ id: row.id, kind: row.kind, role: row.role, ordinal: row.ordinal, locked: row.locked === 1,
      provenance: row.provenance, recipeId: row.recipe_id, simpleFoodId: row.simple_food_id,
      createdRevision: row.created_revision, updatedRevision: row.updated_revision });
  }
  return compositions;
}

/** Cheap existence probe used by V1 operations to decide whether a plan has canonical V2 slots. */
export async function planHasCompositions(db: D1DatabaseBinding, rawScope: unknown, rawPlanId: unknown): Promise<boolean> {
  const scope = ScopeSchema.parse(rawScope);
  const planId = CatalogIdSchema.parse(rawPlanId);
  const rows = await all(db, db.prepare(`SELECT 1 FROM generated_meal_plan_compositions
    WHERE plan_id = ? AND EXISTS (${OWNED_PLAN}) LIMIT 1`).bind(planId, planId, scope.householdId, scope.userId), 'existence');
  return rows.length === 1;
}

/** Persisted role rows for exactly the requested (authority-visible) recipes. */
export async function readRoleAssignments(db: D1DatabaseBinding, visibleRecipeIds: ReadonlySet<string>): Promise<PersistedRoleAssignment[]> {
  if (!visibleRecipeIds.size) return [];
  const rows = await all(db, db.prepare(`SELECT recipe_id, role, source, decision, confidence, reviewed
    FROM recipe_role_assignments ORDER BY recipe_id, role, source`), 'role assignment');
  return rows.map((raw) => RoleRowSchema.parse(raw)).filter((row) => visibleRecipeIds.has(row.recipe_id))
    .map((row) => ({ recipeId: row.recipe_id, role: row.role, source: row.source, decision: row.decision,
      confidence: row.confidence, reviewed: row.reviewed === 1 }));
}

export async function writePlanCompositions(db: D1DatabaseBinding, rawScope: unknown,
  input: WritePlanCompositionsInput): Promise<GeneratedMealPlanRecord> {
  const scope = ScopeSchema.parse(rawScope);
  const planId = CatalogIdSchema.parse(input.planId);
  const expected = RevisionSchema.parse(input.expectedRevision);
  const next = expected + 1;
  const slotIds = input.slots.map((slot) => SlotIdSchema.parse(slot.slotId));
  if (new Set(slotIds).size !== slotIds.length) throw new Error('Composition write repeats a slot');
  const statements: D1PreparedStatement[] = [
    // Revision fence: inserting NULLs violates NOT NULL and aborts the batch unless the owned plan
    // is still at the expected revision.
    db.prepare(`INSERT INTO generated_meal_plan_compositions
        (plan_id, household_id, creator_user_id, slot_id, mode, created_revision, updated_revision)
      SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL
      WHERE NOT EXISTS (${OWNED_PLAN} AND plan.revision = ?)`)
      .bind(planId, scope.householdId, scope.userId, expected),
  ];
  if (input.planUpdate) {
    statements.push(db.prepare(`UPDATE generated_meal_plans
      SET intent_json = ?, result_json = ?, source_json = ?, revision = revision + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND household_id = ? AND creator_user_id = ? AND revision = ?
      RETURNING *`).bind(
      canonicalGeneratedMealPlanPayload(input.planUpdate.intentJson, 'intent'),
      canonicalGeneratedMealPlanPayload(input.planUpdate.resultJson, 'result'),
      canonicalGeneratedMealPlanPayload(input.planUpdate.sourceJson, 'source'),
      planId, scope.householdId, scope.userId, expected));
  } else {
    statements.push(db.prepare(`UPDATE generated_meal_plans
      SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND household_id = ? AND creator_user_id = ? AND revision = ?
      RETURNING *`)
      .bind(planId, scope.householdId, scope.userId, expected));
  }
  for (const slotId of input.deleteSlotIds ?? []) {
    statements.push(
      db.prepare('DELETE FROM generated_meal_plan_components WHERE plan_id = ? AND slot_id = ?').bind(planId, SlotIdSchema.parse(slotId)),
      db.prepare('DELETE FROM generated_meal_plan_compositions WHERE plan_id = ? AND slot_id = ?').bind(planId, slotId),
    );
  }
  for (const slot of input.slots) {
    const mode = CompositionModeSchema.parse(slot.mode);
    const createdRevision = RevisionSchema.parse(slot.createdRevision);
    if (slot.components.length > MAX_COMPONENTS_PER_MEAL) throw new Error('Composition exceeds component limit');
    statements.push(
      db.prepare('DELETE FROM generated_meal_plan_components WHERE plan_id = ? AND slot_id = ?').bind(planId, slot.slotId),
      db.prepare('DELETE FROM generated_meal_plan_compositions WHERE plan_id = ? AND slot_id = ?').bind(planId, slot.slotId),
      db.prepare(`INSERT INTO generated_meal_plan_compositions
          (plan_id, household_id, creator_user_id, slot_id, mode, created_revision, updated_revision, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`)
        .bind(planId, scope.householdId, scope.userId, slot.slotId, mode, createdRevision, next, slot.createdAt),
    );
    for (const component of slot.components) {
      statements.push(db.prepare(`INSERT INTO generated_meal_plan_components
          (plan_id, id, slot_id, ordinal, kind, role, recipe_id, simple_food_id, locked, provenance, created_revision, updated_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        planId, ComponentIdSchema.parse(component.id), slot.slotId, component.ordinal, component.kind,
        MealRoleSchema.parse(component.role), component.recipeId, component.simpleFoodId, component.locked ? 1 : 0,
        ComponentProvenanceSchema.parse(component.provenance), component.createdRevision, component.updatedRevision));
    }
  }
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    // Classification only; the batch was rolled back as a unit.
    const current = await getGeneratedMealPlan(db, scope, planId);
    if (current.revision !== expected) throw new GeneratedMealPlanPersistenceError('REVISION_CONFLICT');
    throw error;
  }
  const updated = results[1];
  if (results.some((result) => !result.success) || updated?.results.length !== 1) {
    throw new GeneratedMealPlanPersistenceError('REVISION_CONFLICT');
  }
  return mapGeneratedMealPlanRow(updated.results[0]);
}
