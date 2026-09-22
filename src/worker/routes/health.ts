import { Hono } from 'hono';
import { Env } from '../types';
import { getAIServiceStatus, validateEnvironment } from '../config/validation';
import {
  publicRecipeAuthorityStatus,
  recipeAuthorityReleaseEvidence,
  releaseVerifyTokenMatches,
  type RecipeAuthorityPublicStatus,
} from '../services/recipe-authority-status';

/**
 * Public observability endpoints, mounted OUTSIDE the auth-protected API
 * router so load balancers and operators can reach them without a JWT.
 * Everything here is sanitized: statuses and feature flags only — never
 * secret values, token material, or binding identifiers.
 */

export const healthRoutes = new Hono<{ Bindings: Env }>();

// Public liveness: disclose as little as possible.
healthRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    app: 'Frigo',
    timestamp: new Date().toISOString(),
  });
});

// Public readiness: sanitized service states + configuration issue codes.
// `unhealthy` means an essential dependency or production configuration is
// broken; `degraded` keeps serving but reports warnings.
healthRoutes.get('/health/ready', async (c) => {
  const env = c.env;

  let database: 'ok' | 'error' = 'ok';
  if (env.DB) {
    try {
      await env.DB.prepare('SELECT 1 AS ok').first();
      // Candidate scan paths read these additive columns before any provider
      // call; fail readiness instead of accepting traffic against schema 0022.
      await env.DB.prepare(
        'SELECT request_fingerprint, image_mime_type FROM scans LIMIT 0',
      ).all();
    } catch {
      database = 'error';
    }
  } else {
    database = 'error';
  }

  const config = validateEnvironment(env);
  const unhealthy = config.fatal.length > 0 || database === 'error';
  // T19C: sanitized recipe authority summary. Never household/user data; failures degrade to
  // `invalid` rather than taking readiness down for an observability-only field.
  let recipeAuthority: RecipeAuthorityPublicStatus | { configuredMode: 'invalid'; fallbackReason: string };
  try {
    recipeAuthority = await publicRecipeAuthorityStatus(env);
  } catch {
    recipeAuthority = { configuredMode: 'invalid', fallbackReason: 'STATUS_UNAVAILABLE' };
  }

  return c.json(
    {
      status: unhealthy ? 'unhealthy' : config.warnings.length > 0 ? 'degraded' : 'ok',
      app: 'Frigo',
      version: '0.1.0',
      commit: env.GIT_COMMIT || null,
      timestamp: new Date().toISOString(),
      environment: env.ENVIRONMENT || 'development',
      recipeAuthority,
      services: {
        database,
        queue: env.SCAN_QUEUE ? 'ok' : env.SCAN_QUEUE_MODE === 'async' ? 'error' : 'disabled',
        // Reflect the providers AIRouter can actually construct. In
        // particular, a native AI binding alone is not an OCR capability when
        // its explicit fallback flag is disabled.
        ai: getAIServiceStatus(env),
        email: {
          providerConfigured: Boolean(env.SEND_EMAIL || env.RESEND_API_KEY),
          // Readiness is side-effect free, so it cannot certify inbox delivery.
          deliveryVerified: false,
        },
        rateLimiting: env.CACHE
          ? env.RATE_LIMIT_ENFORCEMENT === 'fail-closed'
            ? 'kv-fail-closed'
            : 'kv-best-effort'
          : 'isolate-local',
      },
      config: {
        ok: config.ok,
        issues: [...config.fatal, ...config.warnings].map((issue) => ({
          code: issue.code,
          severity: issue.severity,
        })),
      },
    },
    unhealthy ? 503 : 200
  );
});

// T19C: protected, machine-readable recipe authority release evidence for deploy automation.
// Authorized by the RELEASE_VERIFY_TOKEN Worker secret (bearer), never by a user session; the
// route does not exist (404) when the secret is not configured. Body is PII-free by construction.
healthRoutes.get('/health/recipe-authority', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!c.env.RELEASE_VERIFY_TOKEN) return c.json({ error: 'Not found' }, 404);
  const presented = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!(await releaseVerifyTokenMatches(presented, c.env.RELEASE_VERIFY_TOKEN))) {
    return c.json({ error: 'Unauthorized', code: 'RELEASE_VERIFY_UNAUTHORIZED' }, 401);
  }
  return c.json(await recipeAuthorityReleaseEvidence(c.env));
});

// Public browser configuration only. OAuth client IDs and Turnstile site keys
// identify applications; neither value is a secret.
healthRoutes.get('/config', (c) => {
  return c.json({
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    googleClientId: c.env.GOOGLE_CLIENT_ID || null,
  });
});
