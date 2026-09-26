import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AuthContext, Env } from '../types';
import { tenancyGuard } from '../middleware/tenancy';
import { rateLimiter } from '../middleware/rate-limit';
import {
  MealPlanningIntentSchema, PlanIdSchema, PlanningRequestKeySchema, RegenerateMealPlanSchema,
  SwapMealSchema, OptimizePlanShoppingSchema, PlanFeedbackSchema,
} from '../../../packages/domain/src/meal-planning-api';
import { GeneratedMealPlanPersistenceError } from '../../../packages/db/src/meal-planning';
import { MealPlanningSnapshotAuthorizationError } from '../../../packages/db/src/meal-planning-snapshot';
import { MealPlanningApplicationService, type MealPlanningServiceOptions } from '../services/meal-planning';
import { MealPlanningError } from '../services/meal-planning-error';
import { PlanAlternativesQuerySchema, PlanExplanationRequestSchema } from '../../../packages/domain/src/meal-planning-presentation';
import { createExplanationTransport } from '../services/meal-planning-explanation';
import { backgroundExecutorOf, resolveRecipeAuthority } from '../services/recipe-authority';
import {
  AddComponentSchema, AssistApplySchema, AssistRequestSchema, AutoApplySchema, AutoRequestSchema, ComponentIdSchema,
  CompositionSlotIdSchema, PickerQuerySchema, RemoveComponentQuerySchema, ReplaceCompositionSchema, SwapComponentSchema,
  UpdateComponentSchema,
} from '../../../packages/domain/src/meal-composition-api';

type App = { Bindings: Env; Variables: { auth: AuthContext } };
type Ctx = Context<App>;

async function body<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<z.output<T>> {
  let json: unknown;
  try { json = await c.req.json(); }
  catch { throw new MealPlanningError('INVALID_JSON', 400, 'Expected a JSON request body'); }
  const result = schema.safeParse(json);
  if (!result.success) throw new MealPlanningError('INVALID_REQUEST', 422, 'Request fields do not match the meal-planning contract');
  return result.data;
}

function key(c: Ctx) {
  const result = PlanningRequestKeySchema.safeParse(c.req.header('Idempotency-Key'));
  if (!result.success) throw new MealPlanningError('IDEMPOTENCY_KEY_REQUIRED', 400, 'A valid Idempotency-Key header is required');
  return result.data;
}

async function respond(c: Ctx, operation: () => Promise<unknown>) {
  try { return c.json(await operation()); }
  catch (error) {
    if (error instanceof MealPlanningError) return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof MealPlanningSnapshotAuthorizationError) return c.json({ code: 'TENANCY_VIOLATION', error: 'Household access denied' }, 403);
    if (error instanceof GeneratedMealPlanPersistenceError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 409;
      const code = error.code === 'REVISION_CONFLICT' ? 'PLAN_REVISION_CONFLICT' : error.code;
      return c.json({ code, error: status === 404 ? 'Plan not found' : status === 403 ? 'Household access denied' : 'Request conflicts with current plan state' }, status);
    }
    console.error(JSON.stringify({ level: 'error', event: 'meal_planning_failure', code: 'MEAL_PLANNING_UNAVAILABLE' }));
    return c.json({ code: 'MEAL_PLANNING_UNAVAILABLE', error: 'Meal planning could not be completed' }, 500);
  }
}

/** Options are installed by server composition, never HTTP JSON or environment request fields. */
export function createMealPlanningRoutes(options: Partial<MealPlanningServiceOptions> = {}) {
  const routes = new Hono<App>();
  routes.use('/meal-planning/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const auth = c.get('auth');
    if (!auth?.userId) return c.json({ code: 'UNAUTHORIZED', error: 'Authentication required' }, 401);
    if (auth.isGuest) return c.json({ code: 'REGISTERED_ACCOUNT_REQUIRED', error: 'Registered household membership required' }, 403);
    if (c.env.MEAL_PLANNER_ENABLED !== 'true') return c.json({ code: 'MEAL_PLANNER_DISABLED', error: 'Meal planner is not enabled' }, 404);
    await next();
  });
  routes.use('/meal-planning/*', tenancyGuard);
  routes.use('/meal-planning/*', bodyLimit({ maxSize: 65_536, onError: (c) => c.json({ code: 'REQUEST_TOO_LARGE', error: 'Request exceeds 64 KiB' }, 413) }));
  const expensive = rateLimiter({ maxRequests: 10, windowSeconds: 60, prefix: 'meal-planning-expensive' });
  const compute = rateLimiter({ maxRequests: 10, windowSeconds: 60, prefix: 'planner-compute', scope: 'account' });
  const feedbackLimit = rateLimiter({ maxRequests: 60, windowSeconds: 60, prefix: 'meal-planning-feedback' });
  const reads = rateLimiter({ maxRequests: 60, windowSeconds: 60, prefix: 'meal-planning-read' });
  const service = (c: Ctx) => new MealPlanningApplicationService(c.env.DB, {
    ...options,
    explanationTransport: options.explanationTransport ?? createExplanationTransport(
      c.env,
      (promise) => c.executionCtx.waitUntil(promise),
    ),
    // T19 (ADR-026): the same deployment-config + deterministic household-canary decision the recipe routes make.
    recipeAuthority: options.recipeAuthority ?? (async (scope) =>
      (await resolveRecipeAuthority(c.env, { tenantKey: scope.householdId, backgroundExecutor: backgroundExecutorOf(c) })).snapshot),
    // T20: independent of every T19 recipe-authority flag.
    compositionV2Enabled: c.env.MEAL_COMPOSITION_V2_ENABLED === 'true',
  });
  const scope = (c: Ctx) => ({ householdId: c.get('auth').householdId, userId: c.get('auth').userId });
  const planId = (c: Ctx) => {
    const parsed = PlanIdSchema.safeParse(c.req.param('id'));
    if (!parsed.success) throw new MealPlanningError('INVALID_PLAN_ID', 422, 'Invalid plan ID');
    return parsed.data;
  };

  routes.post('/meal-planning/plans', compute, expensive, (c) => respond(c, async () =>
    service(c).generate(scope(c), await body(c, MealPlanningIntentSchema), key(c))));
  routes.get('/meal-planning/plans/current', reads, (c) => respond(c, () => service(c).current(scope(c))));
  routes.get('/meal-planning/plans/:id', reads, (c) => respond(c, () => service(c).get(scope(c), planId(c))));
  routes.get('/meal-planning/plans/:id/alternatives', reads, (c) => respond(c, () => {
    const parsed = PlanAlternativesQuerySchema.safeParse(c.req.query());
    if (!parsed.success || Object.values(c.req.queries()).some((values) => values.length !== 1)) {
      throw new MealPlanningError('INVALID_REQUEST', 422, 'A single positive plan revision is required');
    }
    return service(c).alternatives(scope(c), planId(c), parsed.data.revision);
  }));
  routes.post('/meal-planning/plans/:id/explanation', compute, expensive, (c) => respond(c, async () =>
    service(c).explanation(scope(c), planId(c), await body(c, PlanExplanationRequestSchema), c.env.MEAL_PLANNER_AI_ENABLED === 'true')));
  routes.post('/meal-planning/plans/:id/regenerate', compute, expensive, (c) => respond(c, async () =>
    service(c).regenerate(scope(c), planId(c), await body(c, RegenerateMealPlanSchema))));
  routes.post('/meal-planning/plans/:id/swap', compute, expensive, (c) => respond(c, async () =>
    service(c).swap(scope(c), planId(c), await body(c, SwapMealSchema))));
  routes.post('/meal-planning/plans/:id/shopping', compute, expensive, (c) => respond(c, async () =>
    service(c).shopping(scope(c), planId(c), await body(c, OptimizePlanShoppingSchema))));
  // ---------------------------------------------------------------- T20 Meal Composition V2 (ADR-031)
  const compositionGate = async (c: Ctx, next: () => Promise<void>) => {
    if (c.env.MEAL_COMPOSITION_V2_ENABLED !== 'true') {
      return c.json({ code: 'MEAL_COMPOSITION_DISABLED', error: 'Meal composition is not enabled' }, 404);
    }
    await next();
  };
  routes.use('/meal-planning/plans/:id/compositions', compositionGate);
  routes.use('/meal-planning/plans/:id/slots/*', compositionGate);
  routes.use('/meal-planning/compositions/*', compositionGate);
  const compositionWrites = rateLimiter({ maxRequests: 60, windowSeconds: 60, prefix: 'meal-composition-write' });
  const compositions = (c: Ctx) => service(c).compositions();
  const slotId = (c: Ctx) => {
    const parsed = CompositionSlotIdSchema.safeParse(c.req.param('slotId'));
    if (!parsed.success) throw new MealPlanningError('INVALID_SLOT_ID', 422, 'Invalid meal slot ID');
    return parsed.data;
  };
  const componentId = (c: Ctx) => {
    const parsed = ComponentIdSchema.safeParse(c.req.param('componentId'));
    if (!parsed.success) throw new MealPlanningError('INVALID_COMPONENT_ID', 422, 'Invalid component ID');
    return parsed.data;
  };
  const slotPath = '/meal-planning/plans/:id/slots/:slotId';
  routes.get('/meal-planning/plans/:id/compositions', reads, (c) => respond(c, () =>
    compositions(c).compositions(scope(c), planId(c))));
  routes.get(`${slotPath}/composition`, reads, (c) => respond(c, () =>
    compositions(c).composition(scope(c), planId(c), slotId(c))));
  routes.put(`${slotPath}/composition`, compositionWrites, (c) => respond(c, async () =>
    compositions(c).replace(scope(c), planId(c), slotId(c), await body(c, ReplaceCompositionSchema))));
  routes.post(`${slotPath}/components`, compositionWrites, (c) => respond(c, async () =>
    compositions(c).add(scope(c), planId(c), slotId(c), await body(c, AddComponentSchema))));
  routes.post(`${slotPath}/components/:componentId/swap`, compositionWrites, (c) => respond(c, async () =>
    compositions(c).swap(scope(c), planId(c), slotId(c), componentId(c), await body(c, SwapComponentSchema))));
  routes.patch(`${slotPath}/components/:componentId`, compositionWrites, (c) => respond(c, async () =>
    compositions(c).update(scope(c), planId(c), slotId(c), componentId(c), await body(c, UpdateComponentSchema))));
  routes.delete(`${slotPath}/components/:componentId`, compositionWrites, (c) => respond(c, () => {
    const parsed = RemoveComponentQuerySchema.safeParse(c.req.query());
    if (!parsed.success || Object.values(c.req.queries()).some((values) => values.length !== 1)) {
      throw new MealPlanningError('INVALID_REQUEST', 422, 'A single positive plan revision is required');
    }
    return compositions(c).remove(scope(c), planId(c), slotId(c), componentId(c), Number(parsed.data.revision));
  }));
  routes.post(`${slotPath}/assist`, compute, expensive, (c) => respond(c, async () =>
    compositions(c).assist(scope(c), planId(c), slotId(c), await body(c, AssistRequestSchema))));
  routes.post(`${slotPath}/assist/apply`, compute, expensive, (c) => respond(c, async () =>
    compositions(c).assistApply(scope(c), planId(c), slotId(c), await body(c, AssistApplySchema))));
  routes.post(`${slotPath}/auto`, compute, expensive, (c) => respond(c, async () =>
    compositions(c).auto(scope(c), planId(c), slotId(c), await body(c, AutoRequestSchema))));
  routes.post(`${slotPath}/auto/apply`, compute, expensive, (c) => respond(c, async () =>
    compositions(c).autoApply(scope(c), planId(c), slotId(c), await body(c, AutoApplySchema))));
  routes.get('/meal-planning/compositions/picker', reads, (c) => respond(c, () => {
    const parsed = PickerQuerySchema.safeParse(c.req.query());
    if (!parsed.success || Object.values(c.req.queries()).some((values) => values.length !== 1)) {
      throw new MealPlanningError('INVALID_REQUEST', 422, 'Picker query does not match the contract');
    }
    return compositions(c).picker(scope(c), parsed.data);
  }));

  routes.post('/meal-planning/plans/:id/feedback', feedbackLimit, (c) => respond(c, async () =>
    service(c).feedback(scope(c), planId(c), await body(c, PlanFeedbackSchema), key(c))));
  return routes;
}

export const mealPlanningRoutes = createMealPlanningRoutes();
