import { describe, expect, it, vi } from 'vitest';
import {
  MODIFIED_SECRET_ERROR_CODE,
  rollbackWorker,
  resolveRollbackInputs,
  validateRollbackInputs,
} from '../../scripts/cloudflare-worker-rollback.mjs';

const accountId = 'a'.repeat(32);
const apiToken = 'test-token-never-log';
const versionId = 'version-20260922';
const base = {
  accountId,
  apiToken,
  versionId,
  scriptName: 'frigo',
  apiBaseUrl: 'https://api.cloudflare.test/client/v4',
  retryDelayMs: 1,
};

function apiResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function successResponse(id = 'deployment-abc123') {
  return apiResponse(200, {
    result: { id },
    success: true,
    errors: [],
    messages: [],
  });
}

function errorResponse(code, status = 400, message = 'rollback rejected') {
  return apiResponse(status, {
    result: null,
    success: false,
    errors: [{ code, message }],
    messages: [],
  });
}

function requestDetails(fetchMock, index = 0) {
  const [url, init] = fetchMock.mock.calls[index];
  return {
    url: String(url),
    init,
    body: JSON.parse(String(init.body)),
  };
}

describe('Cloudflare Worker rollback helper', () => {
  it('validates account, script, version, and token inputs without echoing secrets', () => {
    expect(validateRollbackInputs({ accountId, scriptName: 'frigo', versionId, apiToken })).toEqual({
      accountId,
      scriptName: 'frigo',
      versionId,
      apiToken,
    });

    for (const invalid of [
      { accountId: 'not-an-account' },
      { accountId: 'a'.repeat(31) },
      { accountId, scriptName: '../frigo' },
      { accountId, scriptName: 'frigo', versionId: '../other' },
      { accountId, scriptName: 'frigo', versionId, apiToken: '' },
      { accountId, scriptName: 'frigo', versionId, apiToken: 'token with spaces' },
    ]) {
      expect(() => validateRollbackInputs({
        accountId: invalid.accountId ?? accountId,
        scriptName: invalid.scriptName ?? 'frigo',
        versionId: invalid.versionId ?? versionId,
        apiToken: invalid.apiToken ?? apiToken,
      })).toThrow(/required|unsupported|exactly 32|characters/);
    }
  });

  it('uses frigo by default and only accepts a validated explicit script environment override', () => {
    expect(resolveRollbackInputs({
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_WORKER_VERSION_ID: versionId,
      },
    })).toMatchObject({ scriptName: 'frigo', versionId, accountId, apiToken });
    expect(resolveRollbackInputs({
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_WORKER_VERSION_ID: versionId,
        CLOUDFLARE_WORKER_SCRIPT_NAME: 'frigo-staging',
      },
    })).toMatchObject({ scriptName: 'frigo-staging' });
    expect(() => resolveRollbackInputs({
      env: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_WORKER_VERSION_ID: versionId,
        CLOUDFLARE_WORKER_SCRIPT_NAME: 'frigo/staging',
      },
    })).toThrow('unsupported characters');
  });

  it('posts the exact percentage deployment body and returns sanitized deployment proof', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    const log = vi.fn();

    await expect(rollbackWorker({ ...base, fetch: fetchMock, log })).resolves.toEqual({
      deploymentId: 'deployment-abc123',
      versionId,
      percentage: 100,
      scriptName: 'frigo',
      attempts: 1,
      forceUsed: false,
    });

    const request = requestDetails(fetchMock);
    expect(request.url).toBe(
      'https://api.cloudflare.test/client/v4/accounts/'
        + `${accountId}/workers/scripts/frigo/deployments`,
    );
    expect(request.init.method).toBe('POST');
    expect(request.body).toEqual({
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
    });
    expect(request.init.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    });
    expect(request.init.signal).toBeInstanceOf(AbortSignal);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining(apiToken));
  });

  it('retries network, 429, and 5xx failures within the deadline', async () => {
    let clock = 0;
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(apiResponse(503, { success: false, errors: [] }))
      .mockResolvedValueOnce(apiResponse(429, { success: false, errors: [] }))
      .mockResolvedValueOnce(successResponse('deployment-retried'));
    const sleep = vi.fn(async (milliseconds) => { clock += milliseconds; });
    const log = vi.fn();

    await expect(rollbackWorker({
      ...base,
      fetch: fetchMock,
      now: () => clock,
      sleep,
      deadlineMs: 100,
      log,
    })).resolves.toMatchObject({
      deploymentId: 'deployment-retried',
      attempts: 4,
      forceUsed: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.flat().join('\n')).not.toContain(apiToken);
    for (let index = 0; index < fetchMock.mock.calls.length; index += 1) {
      expect(requestDetails(fetchMock, index).url).not.toContain('force=true');
    }
  });

  it('retries code 10220 exactly once with force=true and never changes the body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(MODIFIED_SECRET_ERROR_CODE, 400, 'changed secret'))
      .mockResolvedValueOnce(successResponse('deployment-forced'));

    await expect(rollbackWorker({ ...base, fetch: fetchMock })).resolves.toMatchObject({
      deploymentId: 'deployment-forced',
      versionId,
      forceUsed: true,
      attempts: 2,
    });
    const first = requestDetails(fetchMock, 0);
    const second = requestDetails(fetchMock, 1);
    expect(first.url).not.toContain('?force=true');
    expect(second.url).toContain('?force=true');
    expect(second.body).toEqual(first.body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not force or retry a non-10220 Cloudflare error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(10090, 403, 'permission denied'));

    await expect(rollbackWorker({ ...base, fetch: fetchMock })).rejects.toMatchObject({
      code: 'CLOUDFLARE_API_ERROR',
      cloudflareCode: 10090,
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestDetails(fetchMock).url).not.toContain('force=true');
  });

  it('does not force a second time when code 10220 persists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(MODIFIED_SECRET_ERROR_CODE))
      .mockResolvedValueOnce(errorResponse(MODIFIED_SECRET_ERROR_CODE));

    await expect(rollbackWorker({ ...base, fetch: fetchMock })).rejects.toMatchObject({
      code: 'CLOUDFLARE_API_ERROR',
      cloudflareCode: MODIFIED_SECRET_ERROR_CODE,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestDetails(fetchMock, 1).url).toContain('?force=true');
    expect(requestDetails(fetchMock, 1).url).not.toContain('?force=true&force=true');
  });

  it('bounds an individual fetch and then fails at the total deadline', async () => {
    const fetchMock = vi.fn((_, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
    }));
    const started = Date.now();

    await expect(rollbackWorker({
      ...base,
      fetch: fetchMock,
      requestTimeoutMs: 5,
      deadlineMs: 15,
      retryDelayMs: 1,
    })).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    expect(Date.now() - started).toBeLessThan(500);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBeLessThan(5);
  });

  it('fails closed when transient retries exhaust a controlled total deadline', async () => {
    let clock = 0;
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    const sleep = vi.fn(async (milliseconds) => { clock += milliseconds; });

    await expect(rollbackWorker({
      ...base,
      fetch: fetchMock,
      now: () => clock,
      sleep,
      deadlineMs: 6,
      retryDelayMs: 2,
    })).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never includes the API token in sanitized failure output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(10090, 403, `token=${apiToken}`));
    const log = vi.fn();

    const failure = await rollbackWorker({ ...base, fetch: fetchMock, log }).catch((error) => error);
    expect(failure.message).not.toContain(apiToken);
    expect(log.mock.calls.flat().join('\n')).not.toContain(apiToken);
  });
});
