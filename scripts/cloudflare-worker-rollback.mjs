import { pathToFileURL } from 'node:url';

export const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
export const DEFAULT_WORKER_SCRIPT_NAME = 'frigo';
export const DEFAULT_DEADLINE_MS = 90_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRY_DELAY_MS = 1_000;
export const MAX_RETRY_DELAY_MS = 10_000;
export const MODIFIED_SECRET_ERROR_CODE = 10220;

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
const VERSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROOF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/**
 * Wrangler 3.114.17 creates a percentage deployment with this request:
 * POST /accounts/{account_id}/workers/scripts/{script_name}/deployments
 * {"strategy":"percentage","versions":[{"version_id":"<id>","percentage":100}]}
 * Its 10220 confirmation retries the same body at the same endpoint with ?force=true.
 */
export class WorkerRollbackError extends Error {
  constructor(message, { code = 'WORKER_ROLLBACK_FAILED', status, cloudflareCode } = {}) {
    super(message);
    this.name = 'WorkerRollbackError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (cloudflareCode !== undefined) this.cloudflareCode = cloudflareCode;
  }
}

class RequestTimeoutError extends WorkerRollbackError {
  constructor(timeoutMs) {
    super(`Cloudflare rollback request timed out after ${timeoutMs} ms`, {
      code: 'REQUEST_TIMEOUT',
    });
  }
}

class NetworkRequestError extends WorkerRollbackError {
  constructor(error, apiToken) {
    const rawKind = typeof error?.code === 'string'
      ? error.code
      : typeof error?.name === 'string'
        ? error.name
        : 'network failure';
    const kind = rawKind.replaceAll(apiToken, '[redacted]').slice(0, 80);
    super(`Cloudflare rollback request failed before receiving a response (${kind})`, {
      code: 'NETWORK_ERROR',
    });
  }
}

function requiredString(name, value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new WorkerRollbackError(`${name} is required`, { code: 'INVALID_INPUT' });
  }
  return value;
}

function positiveNumber(name, value, { allowZero = false } = {}) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || (allowZero ? value < 0 : value <= 0)
  ) {
    throw new WorkerRollbackError(`${name} must be a finite integer ${allowZero ? 'at least zero' : 'greater than zero'}`, {
      code: 'INVALID_INPUT',
    });
  }
  return value;
}

function envValue(env, ...names) {
  for (const name of names) {
    if (env[name] !== undefined) return env[name];
  }
  return undefined;
}

export function validateRollbackInputs({ accountId, scriptName, versionId, apiToken, token } = {}) {
  const normalizedAccountId = requiredString('Cloudflare account ID', accountId);
  if (!ACCOUNT_ID_PATTERN.test(normalizedAccountId)) {
    throw new WorkerRollbackError('Cloudflare account ID must be exactly 32 hexadecimal characters', {
      code: 'INVALID_INPUT',
    });
  }

  const normalizedScriptName = requiredString('Worker script name', scriptName);
  if (!SCRIPT_NAME_PATTERN.test(normalizedScriptName)) {
    throw new WorkerRollbackError('Worker script name contains unsupported characters', {
      code: 'INVALID_INPUT',
    });
  }

  const normalizedVersionId = requiredString('Worker version ID', versionId);
  if (!VERSION_ID_PATTERN.test(normalizedVersionId)) {
    throw new WorkerRollbackError('Worker version ID contains unsupported characters', {
      code: 'INVALID_INPUT',
    });
  }

  const normalizedToken = requiredString('CLOUDFLARE_API_TOKEN', apiToken ?? token);
  if (/\s/.test(normalizedToken) || normalizedToken.length > 4096) {
    throw new WorkerRollbackError('CLOUDFLARE_API_TOKEN contains unsupported characters', {
      code: 'INVALID_INPUT',
    });
  }

  return {
    accountId: normalizedAccountId,
    scriptName: normalizedScriptName,
    versionId: normalizedVersionId,
    apiToken: normalizedToken,
  };
}

export function resolveRollbackInputs({
  env = process.env,
  accountId,
  scriptName,
  versionId,
  apiToken,
  token,
} = {}) {
  return validateRollbackInputs({
    accountId: accountId ?? env.CLOUDFLARE_ACCOUNT_ID,
    // The primary override is explicit and names the API script, while the Wrangler-style
    // alias keeps this helper usable with existing Worker environment configuration.
    scriptName: scriptName
      ?? envValue(env, 'CLOUDFLARE_WORKER_SCRIPT_NAME', 'CLOUDFLARE_WORKER_NAME')
      ?? DEFAULT_WORKER_SCRIPT_NAME,
    versionId: versionId ?? env.CLOUDFLARE_WORKER_VERSION_ID,
    apiToken: apiToken ?? token ?? env.CLOUDFLARE_API_TOKEN,
  });
}

function apiOrigin(apiBaseUrl) {
  let parsed;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw new WorkerRollbackError('Cloudflare API base URL is invalid', { code: 'INVALID_INPUT' });
  }
  if (parsed.protocol !== 'https:' || parsed.search || parsed.hash) {
    throw new WorkerRollbackError('Cloudflare API base URL must be an HTTPS origin without query or hash', {
      code: 'INVALID_INPUT',
    });
  }
  return parsed.href.replace(/\/$/, '');
}

export function buildDeploymentsUrl({ accountId, scriptName, force = false, apiBaseUrl = CLOUDFLARE_API_BASE_URL }) {
  const origin = apiOrigin(apiBaseUrl);
  const url = new URL(
    `${origin}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/deployments`,
  );
  if (force) url.searchParams.set('force', 'true');
  return url.href;
}

function deploymentBody(versionId) {
  return {
    strategy: 'percentage',
    versions: [{ version_id: versionId, percentage: 100 }],
  };
}

function responseStatus(response) {
  return typeof response?.status === 'number' ? response.status : 0;
}

function isTransientStatus(status) {
  return status === 429 || status >= 500;
}

function responseIsSuccessful(response) {
  const status = responseStatus(response);
  return status > 0 ? status >= 200 && status < 300 : response?.ok === true;
}

async function readResponseBody(response) {
  if (typeof response?.json !== 'function') {
    return { body: undefined, parseError: true };
  }
  try {
    return { body: await response.json(), parseError: false };
  } catch {
    return { body: undefined, parseError: true };
  }
}

function cloudflareErrors(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  return errors.filter((error) => error && typeof error === 'object');
}

function cloudflareErrorCode(body) {
  const code = cloudflareErrors(body)
    .map((error) => error.code)
    .map((value) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value))
    .find((value) => Number.isInteger(value));
  return code;
}

function safeDetail(body, apiToken) {
  const detail = cloudflareErrors(body).map((error) => error.message).find((message) => typeof message === 'string');
  if (!detail) return '';
  return detail
    .replaceAll(apiToken, '[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
}

function cloudflareFailure(response, body, apiToken) {
  const status = responseStatus(response);
  const code = cloudflareErrorCode(body);
  const suffix = [status ? `HTTP ${status}` : 'invalid HTTP response', code === undefined ? '' : `code ${code}`, safeDetail(body, apiToken)]
    .filter(Boolean)
    .join(', ');
  return new WorkerRollbackError(`Cloudflare rollback was rejected (${suffix})`, {
    code: 'CLOUDFLARE_API_ERROR',
    status,
    cloudflareCode: code,
  });
}

function sanitizedProofId(value) {
  return typeof value === 'string' && PROOF_ID_PATTERN.test(value) ? value : undefined;
}

function deploymentProof(body, versionId) {
  const result = body?.result;
  const deploymentId = sanitizedProofId(result?.id ?? result?.deployment_id ?? result?.deploymentId);
  if (!deploymentId) {
    throw new WorkerRollbackError('Cloudflare rollback returned no usable deployment ID', {
      code: 'INVALID_RESPONSE',
    });
  }

  if (Array.isArray(result?.versions) && result.versions.length > 0) {
    const target = result.versions.find((version) => version?.version_id === versionId);
    if (!target || target.percentage !== 100) {
      throw new WorkerRollbackError('Cloudflare rollback response did not prove 100% target-version traffic', {
        code: 'INVALID_RESPONSE',
      });
    }
  }

  return { deploymentId, versionId, percentage: 100 };
}

function elapsedMs(now, startedAt) {
  return Math.max(0, now() - startedAt);
}

function deadlineFailure(deadlineMs, attempts) {
  return new WorkerRollbackError(`Cloudflare rollback exceeded its ${deadlineMs} ms total deadline after ${attempts} attempt(s)`, {
    code: 'DEADLINE_EXCEEDED',
  });
}

async function waitForRetry({ now, sleep, startedAt, deadlineMs, retryDelayMs, transientFailures, attempts }) {
  const remaining = deadlineMs - elapsedMs(now, startedAt);
  const delay = Math.min(MAX_RETRY_DELAY_MS, retryDelayMs * 2 ** Math.max(0, transientFailures - 1));
  if (remaining <= delay) throw deadlineFailure(deadlineMs, attempts);
  await sleep(delay);
  if (elapsedMs(now, startedAt) >= deadlineMs) throw deadlineFailure(deadlineMs, attempts);
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs, apiToken) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const request = Promise.resolve().then(async () => {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const parsed = await readResponseBody(response);
    return { response, ...parsed };
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new RequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timedOut || error instanceof RequestTimeoutError) throw error;
    throw new NetworkRequestError(error, apiToken);
  } finally {
    clearTimeout(timer);
  }
}

function validFunction(name, value) {
  if (typeof value !== 'function') {
    throw new WorkerRollbackError(`${name} must be a function`, { code: 'INVALID_INPUT' });
  }
  return value;
}

export async function rollbackWorker({
  env = process.env,
  accountId,
  scriptName,
  versionId,
  apiToken,
  token,
  apiBaseUrl = CLOUDFLARE_API_BASE_URL,
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  deadlineMs = DEFAULT_DEADLINE_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  log = () => {},
} = {}) {
  const inputs = resolveRollbackInputs({ env, accountId, scriptName, versionId, apiToken, token });
  const origin = apiOrigin(apiBaseUrl);
  positiveNumber('deadlineMs', deadlineMs);
  positiveNumber('requestTimeoutMs', requestTimeoutMs);
  positiveNumber('retryDelayMs', retryDelayMs);
  validFunction('fetch', fetchImpl);
  validFunction('now', now);
  validFunction('sleep', sleep);
  validFunction('log', log);

  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new WorkerRollbackError('now() must return a finite number', { code: 'INVALID_INPUT' });
  }

  let attempts = 0;
  let transientFailures = 0;
  let force = false;
  let forceAttempted = false;

  for (;;) {
    const remaining = deadlineMs - elapsedMs(now, startedAt);
    if (remaining <= 0) throw deadlineFailure(deadlineMs, attempts);
    attempts += 1;
    const timeoutMs = Math.max(1, Math.min(requestTimeoutMs, remaining));
    const url = buildDeploymentsUrl({
      accountId: inputs.accountId,
      scriptName: inputs.scriptName,
      force,
      apiBaseUrl: origin,
    });

    let responseInfo;
    try {
      responseInfo = await fetchWithTimeout(
        fetchImpl,
        url,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${inputs.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(deploymentBody(inputs.versionId)),
          redirect: 'error',
        },
        timeoutMs,
        inputs.apiToken,
      );
    } catch (error) {
      if (!(error instanceof RequestTimeoutError) && !(error instanceof NetworkRequestError)) throw error;
      transientFailures += 1;
      log(`rollback attempt ${attempts}: transient ${error.code}; retrying`);
      await waitForRetry({
        now,
        sleep,
        startedAt,
        deadlineMs,
        retryDelayMs,
        transientFailures,
        attempts,
      });
      continue;
    }

    const { response, body, parseError } = responseInfo;
    const errorCode = cloudflareErrorCode(body);
    if (errorCode === MODIFIED_SECRET_ERROR_CODE) {
      if (forceAttempted) throw cloudflareFailure(response, body, inputs.apiToken);
      forceAttempted = true;
      force = true;
      log(`rollback attempt ${attempts}: Cloudflare code ${MODIFIED_SECRET_ERROR_CODE}; retrying with force=true`);
      continue;
    }

    const status = responseStatus(response);
    if (isTransientStatus(status)) {
      transientFailures += 1;
      log(`rollback attempt ${attempts}: transient HTTP ${status}; retrying`);
      await waitForRetry({
        now,
        sleep,
        startedAt,
        deadlineMs,
        retryDelayMs,
        transientFailures,
        attempts,
      });
      continue;
    }

    if (!responseIsSuccessful(response) || body?.success === false) {
      throw cloudflareFailure(response, body, inputs.apiToken);
    }
    if (parseError) {
      throw new WorkerRollbackError('Cloudflare rollback returned invalid JSON', { code: 'INVALID_RESPONSE', status });
    }

    const proof = deploymentProof(body, inputs.versionId);
    return {
      ...proof,
      scriptName: inputs.scriptName,
      attempts,
      forceUsed: forceAttempted,
    };
  }
}

function cliVersionId(args, env) {
  if (args.length > 1 || args[0]?.startsWith('-')) {
    throw new WorkerRollbackError('Usage: node scripts/cloudflare-worker-rollback.mjs <version-id>', {
      code: 'INVALID_INPUT',
    });
  }
  return args[0] ?? env.CLOUDFLARE_WORKER_VERSION_ID;
}

async function main() {
  const versionId = cliVersionId(process.argv.slice(2), process.env);
  const proof = await rollbackWorker({ versionId });
  console.log(JSON.stringify({ ok: true, ...proof }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof WorkerRollbackError ? error.message : 'Cloudflare Worker rollback failed');
    process.exitCode = 1;
  });
}
