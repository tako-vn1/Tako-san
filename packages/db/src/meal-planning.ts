import { z } from 'zod';
import { CatalogIdSchema } from '../../domain/src/foundation';
import { canonicalJson } from '../../recipes/src/planner-context';
import { RecipeIdentitySchema } from '../../recipes/src/personalization';
import type { D1DatabaseBinding, D1Response } from './index';

const GeneratedMealPlanScopeSchema = z.object({
  householdId: CatalogIdSchema,
  userId: CatalogIdSchema,
}).strict();

const RequestKeySchema = z.string().trim().min(1).max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid idempotency key');
const RequestFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid request fingerprint');
const RevisionSchema = z.number().int().safe().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const SlotIdSchema = z.string().trim().min(1).max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Invalid slot ID');
const VersionedPayloadSchema = z.object({
  version: z.literal(1),
  data: z.record(z.unknown()),
}).strict();
const TimestampSchema = z.string().datetime({ offset: true });
const PlanFeedbackWriteSchema = z.object({
  id: CatalogIdSchema,
  planId: CatalogIdSchema,
  expectedRevision: RevisionSchema,
  type: z.enum(['liked', 'disliked', 'skipped', 'swapped']),
  target: RecipeIdentitySchema,
  replacement: RecipeIdentitySchema.optional(),
  occurredAt: TimestampSchema,
}).strict().refine((value) => (value.type === 'swapped') === (value.replacement !== undefined),
  'Only swapped feedback requires a replacement');

const CreateGeneratedMealPlanSchema = z.object({
  id: CatalogIdSchema,
  requestKey: RequestKeySchema,
  // The application service hashes canonicalized validated client intent; it is
  // never accepted directly from an HTTP body.
  requestFingerprint: RequestFingerprintSchema,
  intentJson: z.string().min(1).max(1_000_000),
  resultJson: z.string().min(1).max(5_000_000),
  sourceJson: z.string().min(1).max(1_000_000),
}).strict();

const UpdateGeneratedMealPlanSchema = z.object({
  id: CatalogIdSchema,
  expectedRevision: RevisionSchema,
  intentJson: z.string().min(1).max(1_000_000),
  resultJson: z.string().min(1).max(5_000_000),
  sourceJson: z.string().min(1).max(1_000_000),
}).strict();

const RecordCookedAnnotationSchema = z.object({
  id: CatalogIdSchema,
  planId: CatalogIdSchema,
  expectedRevision: RevisionSchema,
  slotId: SlotIdSchema,
  requestKey: RequestKeySchema,
}).strict();

const GeneratedMealPlanRowSchema = z.object({
  id: CatalogIdSchema,
  household_id: CatalogIdSchema,
  creator_user_id: CatalogIdSchema,
  request_key: RequestKeySchema,
  request_fingerprint: RequestFingerprintSchema,
  revision: z.number().int().safe().min(1),
  intent_json: z.string(),
  result_json: z.string(),
  source_json: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

const GeneratedMealPlanAnnotationRowSchema = z.object({
  id: CatalogIdSchema,
  plan_id: CatalogIdSchema,
  household_id: CatalogIdSchema,
  creator_user_id: CatalogIdSchema,
  plan_revision: z.number().int().safe().min(1),
  slot_id: SlotIdSchema,
  request_key: RequestKeySchema,
  event_type: z.literal('cooked'),
  created_at: TimestampSchema,
}).strict();

export type GeneratedMealPlanScope = z.infer<typeof GeneratedMealPlanScopeSchema>;

/** Opaque, server-written payloads. Their contents are not trusted domain objects. */
export interface GeneratedMealPlanRecord {
  id: string;
  householdId: string;
  creatorUserId: string;
  requestKey: string;
  requestFingerprint: string;
  revision: number;
  intentJson: string;
  resultJson: string;
  sourceJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedMealPlanAnnotation {
  id: string;
  planId: string;
  householdId: string;
  creatorUserId: string;
  planRevision: number;
  slotId: string;
  requestKey: string;
  eventType: 'cooked';
  createdAt: string;
}

export interface CreateGeneratedMealPlanInput {
  id: string;
  requestKey: string;
  requestFingerprint: string;
  intentJson: string;
  resultJson: string;
  sourceJson: string;
}

export interface UpdateGeneratedMealPlanInput {
  id: string;
  expectedRevision: number;
  intentJson: string;
  resultJson: string;
  sourceJson: string;
}

export interface RecordCookedAnnotationInput {
  id: string;
  planId: string;
  expectedRevision: number;
  slotId: string;
  requestKey: string;
}

export class GeneratedMealPlanPersistenceError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT') {
    super(code === 'FORBIDDEN' ? 'Meal planning scope is not authorized' : `Generated meal plan ${code.toLowerCase()}`);
    this.name = 'GeneratedMealPlanPersistenceError';
  }
}

function normalizedPayload(raw: string, label: string): string {
  try {
    return canonicalJson(VersionedPayloadSchema.parse(JSON.parse(raw)));
  } catch {
    throw new Error(`Generated meal plan ${label} JSON is invalid`);
  }
}

function mapPlan(raw: unknown): GeneratedMealPlanRecord {
  const row = GeneratedMealPlanRowSchema.parse(raw);
  // Guard persistence corruption even if it bypassed the migration CHECKs.
  const intentJson = normalizedPayload(row.intent_json, 'intent');
  const resultJson = normalizedPayload(row.result_json, 'result');
  const sourceJson = normalizedPayload(row.source_json, 'source');
  return {
    id: row.id,
    householdId: row.household_id,
    creatorUserId: row.creator_user_id,
    requestKey: row.request_key,
    requestFingerprint: row.request_fingerprint,
    revision: row.revision,
    intentJson,
    resultJson,
    sourceJson,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Shared with the T20 composition writer so both write paths validate plan rows/payloads identically. */
export const mapGeneratedMealPlanRow = (raw: unknown): GeneratedMealPlanRecord => mapPlan(raw);
export const canonicalGeneratedMealPlanPayload = (raw: string, label: string): string => normalizedPayload(raw, label);

function mapAnnotation(raw: unknown): GeneratedMealPlanAnnotation {
  const row = GeneratedMealPlanAnnotationRowSchema.parse(raw);
  return {
    id: row.id,
    planId: row.plan_id,
    householdId: row.household_id,
    creatorUserId: row.creator_user_id,
    planRevision: row.plan_revision,
    slotId: row.slot_id,
    requestKey: row.request_key,
    eventType: row.event_type,
    createdAt: row.created_at,
  };
}

function assertSuccess(response: D1Response): void {
  if (!response.success) throw new Error('Generated meal plan persistence write failed');
}

function changes(response: D1Response): number {
  const value = response.meta.changes;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function rows(db: D1DatabaseBinding, sql: string, bindings: readonly unknown[], label: string): Promise<unknown[]> {
  const result = await db.prepare(sql).bind(...bindings).all<unknown>();
  if (!result.success || !Array.isArray(result.results)) throw new Error(`Generated meal plan ${label} read failed`);
  return result.results;
}

async function hasMembership(db: D1DatabaseBinding, scope: GeneratedMealPlanScope): Promise<boolean> {
  return (await rows(db,
    'SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ? LIMIT 1',
    [scope.householdId, scope.userId], 'membership')).length === 1;
}

async function assertMembership(db: D1DatabaseBinding, scope: GeneratedMealPlanScope): Promise<void> {
  if (!await hasMembership(db, scope)) throw new GeneratedMealPlanPersistenceError('FORBIDDEN');
}

async function currentPlan(
  db: D1DatabaseBinding,
  scope: GeneratedMealPlanScope,
  id: string,
): Promise<GeneratedMealPlanRecord | null> {
  const result = await rows(db, `SELECT plan.*
    FROM generated_meal_plans plan
    JOIN household_members member
      ON member.household_id = plan.household_id AND member.user_id = plan.creator_user_id
    WHERE plan.id = ? AND plan.household_id = ? AND plan.creator_user_id = ?
      AND member.household_id = ? AND member.user_id = ?`,
  [id, scope.householdId, scope.userId, scope.householdId, scope.userId], 'plan');
  if (result.length > 1) throw new Error('Generated meal plan identity is ambiguous');
  return result.length === 1 ? mapPlan(result[0]) : null;
}

async function currentPlanByRequestKey(
  db: D1DatabaseBinding,
  scope: GeneratedMealPlanScope,
  requestKey: string,
): Promise<GeneratedMealPlanRecord | null> {
  const result = await rows(db, `SELECT plan.*
    FROM generated_meal_plans plan
    JOIN household_members member
      ON member.household_id = plan.household_id AND member.user_id = plan.creator_user_id
    WHERE plan.household_id = ? AND plan.creator_user_id = ? AND plan.request_key = ?
      AND member.household_id = ? AND member.user_id = ?`,
  [scope.householdId, scope.userId, requestKey, scope.householdId, scope.userId], 'idempotency');
  if (result.length > 1) throw new Error('Generated meal plan idempotency key is ambiguous');
  return result.length === 1 ? mapPlan(result[0]) : null;
}

async function resolveMissingPlan(
  db: D1DatabaseBinding,
  scope: GeneratedMealPlanScope,
): Promise<never> {
  await assertMembership(db, scope);
  throw new GeneratedMealPlanPersistenceError('NOT_FOUND');
}

/** Retrieves only a currently authorized creator's private generated plan. */
export async function getGeneratedMealPlan(
  db: D1DatabaseBinding,
  rawScope: unknown,
  rawId: unknown,
): Promise<GeneratedMealPlanRecord> {
  const scope = GeneratedMealPlanScopeSchema.parse(rawScope);
  const id = CatalogIdSchema.parse(rawId);
  const plan = await currentPlan(db, scope, id);
  if (plan) return plan;
  return resolveMissingPlan(db, scope);
}

/** Most recently saved plan, including regenerations; ties use the existing owner index. */
export async function findCurrentGeneratedMealPlan(
  db: D1DatabaseBinding,
  rawScope: unknown,
): Promise<GeneratedMealPlanRecord | null> {
  const scope = GeneratedMealPlanScopeSchema.parse(rawScope);
  await assertMembership(db, scope);
  const result = await rows(db, `SELECT plan.*
    FROM generated_meal_plans plan
    JOIN household_members member
      ON member.household_id = plan.household_id AND member.user_id = plan.creator_user_id
    WHERE plan.household_id = ? AND plan.creator_user_id = ?
    ORDER BY plan.updated_at DESC, plan.id DESC LIMIT 1`,
  [scope.householdId, scope.userId], 'current plan');
  if (result.length === 1) return mapPlan(result[0]);
  await assertMembership(db, scope);
  return null;
}

/**
 * Finds a creation replay only inside the authenticated creator's household
 * scope. This is intentionally not a general household-plan listing API:
 * ranking inputs may contain private member preference data.
 */
export async function findGeneratedMealPlanByRequest(
  db: D1DatabaseBinding,
  rawScope: unknown,
  rawRequestKey: unknown,
): Promise<GeneratedMealPlanRecord | null> {
  const scope = GeneratedMealPlanScopeSchema.parse(rawScope);
  const requestKey = RequestKeySchema.parse(rawRequestKey);
  await assertMembership(db, scope);
  return currentPlanByRequestKey(db, scope, requestKey);
}

/** The source plan revision and membership are checked in the feedback INSERT itself. */
export async function insertGeneratedMealPlanFeedback(
  db: D1DatabaseBinding,
  rawScope: unknown,
  rawInput: unknown,
): Promise<boolean> {
  const scope = GeneratedMealPlanScopeSchema.parse(rawScope);
  const input = PlanFeedbackWriteSchema.parse(rawInput);
  const response = await db.prepare(`INSERT INTO recipe_feedback_events
    (id, household_id, user_id, event_type, target_recipe_id, target_family_id,
     replacement_recipe_id, replacement_family_id, occurred_at)
    SELECT ?, plan.household_id, plan.creator_user_id, ?, ?, ?, ?, ?, ?
    FROM generated_meal_plans plan
    JOIN household_members member ON member.household_id = plan.household_id
      AND member.user_id = plan.creator_user_id
    WHERE plan.id = ? AND plan.household_id = ? AND plan.creator_user_id = ? AND plan.revision = ?
    ON CONFLICT(id) DO NOTHING`).bind(
    input.id, input.type,
    input.target.kind === 'recipe' ? input.target.id : null,
    input.target.kind === 'family' ? input.target.id : null,
    input.replacement?.kind === 'recipe' ? input.replacement.id : null,
    input.replacement?.kind === 'family' ? input.replacement.id : null,
    new Date(input.occurredAt).toISOString(),
    input.planId, scope.householdId, scope.userId, input.expectedRevision,
  ).run();
  assertSuccess(response);
  if (changes(response) === 1) return true;
  const plan = await getGeneratedMealPlan(db, scope, input.planId);
  if (plan.revision !== input.expectedRevision) throw new GeneratedMealPlanPersistenceError('REVISION_CONFLICT');
  return false;
}

/**
 * Inserts one current generated result, replaying only an identical canonical
 * request fingerprint. INSERT ... SELECT keeps the membership proof in the
 * same statement as the write.
 */
export async function createGeneratedMealPlan(
  db: D1DatabaseBinding,
  rawScope: unknown,
  rawInput: unknown,
): Promise<{ plan: GeneratedMealPlanRecord; replayed: boolean }> {
  const scope = GeneratedMealPlanScopeSchema.parse(rawScope);
  const input = CreateGeneratedMealPlanSchema.parse(rawInput);
  const payloads = {
    intentJson: normalizedPayload(input.intentJson, 'intent'),
    resultJson: normalizedPayload(input.resultJson, 'result'),
    sourceJson: normalizedPayload(input.sourceJson, 'source'),
  };
  const response = await db.prepare(`INSERT INTO generated_meal_plans
      (id, household_id, creator_user_id, request_key, request_fingerprint, intent_json, result_json, source_json)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?
    )
    ON CONFLICT(household_id, creator_user_id, request_key) DO NOTHING`).bind(
    input.id, scope.householdId, scope.userId, input.requestKey, input.requestFingerprint,
    payloads.intentJson, payloads.resultJson, payloads.sourceJson, scope.householdId, scope.userId,
  ).run();
  assertSuccess(response);

  const byId = await currentPlan(db, scope, input.id);
  if (changes(response) === 1 && byId) return { plan: byId, replayed: false };

  const plan = byId ?? await currentPlanByRequestKey(db, scope, input.requestKey);
  if (!plan) {
    await assertMembership(db, scope);
    throw new Error('Generated meal plan create did not persist');
  }
  if (plan.requestKey !== input.requestKey) {
    // A globally-colliding server ID is an operational error, never a replay.
    throw new Error('Generated meal plan ID already belongs to another request');
  }
  if (plan.requestFingerprint !== input.requestFingerprint) {
    throw new GeneratedMealPlanPersistenceError('IDEMPOTENCY_CONFLICT');
  }
  return { plan, replayed: true };
}

/** Atomically replaces the current opaque result only when the expected revision still matches. */
export async function updateGeneratedMealPlan(
  db: D1DatabaseBinding,
  rawScope: unknown,
  rawInput: unknown,
): Promise<GeneratedMealPlanRecord> {
  const scope = GeneratedMealPlanScopeSchema.parse(rawScope);
  const input = UpdateGeneratedMealPlanSchema.parse(rawInput);
  const payloads = {
    intentJson: normalizedPayload(input.intentJson, 'intent'),
    resultJson: normalizedPayload(input.resultJson, 'result'),
    sourceJson: normalizedPayload(input.sourceJson, 'source'),
  };
  const response = await db.prepare(`UPDATE generated_meal_plans
    SET intent_json = ?, result_json = ?, source_json = ?, revision = revision + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND household_id = ? AND creator_user_id = ? AND revision = ?
      AND EXISTS (
        SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?
      )
    RETURNING *`).bind(
    payloads.intentJson, payloads.resultJson, payloads.sourceJson,
    input.id, scope.householdId, scope.userId, input.expectedRevision, scope.householdId, scope.userId,
  ).all<unknown>();
  assertSuccess(response);
  if (changes(response) === 1) {
    if (response.results.length !== 1) throw new Error('Generated meal plan conditional update returned no row');
    return mapPlan(response.results[0]);
  }

  const existing = await currentPlan(db, scope, input.id);
  if (!existing) return resolveMissingPlan(db, scope);
  if (existing.revision !== input.expectedRevision) {
    throw new GeneratedMealPlanPersistenceError('REVISION_CONFLICT');
  }
  throw new Error('Generated meal plan conditional update failed');
}

/** Records a non-inventory-mutating cooked annotation against the current plan revision. */
export async function recordCookedGeneratedMealPlanAnnotation(
  db: D1DatabaseBinding,
  rawScope: unknown,
  rawInput: unknown,
): Promise<{ annotation: GeneratedMealPlanAnnotation; replayed: boolean }> {
  const scope = GeneratedMealPlanScopeSchema.parse(rawScope);
  const input = RecordCookedAnnotationSchema.parse(rawInput);
  const response = await db.prepare(`INSERT OR IGNORE INTO generated_meal_plan_annotations
      (id, plan_id, household_id, creator_user_id, plan_revision, slot_id, request_key, event_type)
    SELECT ?, plan.id, plan.household_id, plan.creator_user_id, plan.revision, ?, ?, 'cooked'
    FROM generated_meal_plans plan
    JOIN household_members member
      ON member.household_id = plan.household_id AND member.user_id = plan.creator_user_id
    WHERE plan.id = ? AND plan.household_id = ? AND plan.creator_user_id = ? AND plan.revision = ?
      AND member.household_id = ? AND member.user_id = ?`).bind(
    input.id, input.slotId, input.requestKey, input.planId, scope.householdId, scope.userId,
    input.expectedRevision, scope.householdId, scope.userId,
  ).run();
  assertSuccess(response);

  const annotations = await rows(db, `SELECT annotation.*
    FROM generated_meal_plan_annotations annotation
    JOIN household_members member
      ON member.household_id = annotation.household_id AND member.user_id = annotation.creator_user_id
    WHERE annotation.plan_id = ? AND annotation.household_id = ? AND annotation.creator_user_id = ?
      AND annotation.plan_revision = ? AND annotation.slot_id = ? AND annotation.request_key = ?
      AND member.household_id = ? AND member.user_id = ?`,
  [input.planId, scope.householdId, scope.userId, input.expectedRevision, input.slotId, input.requestKey,
    scope.householdId, scope.userId], 'annotation');
  if (annotations.length === 1) return { annotation: mapAnnotation(annotations[0]), replayed: changes(response) === 0 };
  if (annotations.length > 1) throw new Error('Generated meal plan annotation identity is ambiguous');

  const plan = await currentPlan(db, scope, input.planId);
  if (!plan) return resolveMissingPlan(db, scope);
  if (plan.revision !== input.expectedRevision) {
    throw new GeneratedMealPlanPersistenceError('REVISION_CONFLICT');
  }
  throw new Error('Generated meal plan annotation did not persist');
}
