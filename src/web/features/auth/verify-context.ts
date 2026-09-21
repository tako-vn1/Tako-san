/**
 * Tab-scoped route context for screen 03. It carries presentation metadata,
 * never an OTP or credential; the server remains the verification authority.
 */
export const VERIFY_CONTEXT_KEY = 'frigo_auth_verify_context';

export interface VerifyContextOwner {
  userId: string;
  householdId: string;
}

export interface VerifyContext {
  email: string;
  /** Epoch ms after which resend is allowed; 0 when resend is immediately allowed. */
  resendAvailableAt: number;
  /** Epoch ms derived from server OTP metadata; null when the API did not provide it. */
  expiresAt: number | null;
  /** Server-confirmed delivery; null when the response cannot prove email delivery. */
  delivered: boolean | null;
  /** Identity/guest scope that initiated this verification attempt. */
  owner: VerifyContextOwner;
}

type VerifyContextInput = Omit<VerifyContext, 'owner' | 'expiresAt'> &
  Partial<Pick<VerifyContext, 'expiresAt'>>;

const CONTEXT_KEYS = new Set(['email', 'resendAvailableAt', 'expiresAt', 'delivered', 'owner']);
const OWNER_KEYS = new Set(['userId', 'householdId']);
const MAX_DATE_MS = 8_640_000_000_000_000;

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function currentVerifyContextOwner(): VerifyContextOwner {
  try {
    return {
      userId:
        typeof localStorage === 'undefined' ? '' : localStorage.getItem('frigo_user_id') || '',
      householdId:
        typeof localStorage === 'undefined' ? '' : localStorage.getItem('frigo_household_id') || '',
    };
  } catch {
    return { userId: '', householdId: '' };
  }
}

function removeStoredContext(store = sessionStore()): void {
  try {
    store?.removeItem(VERIFY_CONTEXT_KEY);
  } catch {
    // Storage can be unavailable in private browsing; absence is the safe state.
  }
}

export function readVerifyContext(): VerifyContext | null {
  const store = sessionStore();
  let raw: string | null;
  try {
    raw = store?.getItem(VERIFY_CONTEXT_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<VerifyContext> & Record<string, unknown>;
    if (Object.keys(parsed).some((key) => !CONTEXT_KEYS.has(key))) {
      throw new Error('unsafe verification context');
    }
    const email = typeof parsed.email === 'string' ? parsed.email.trim().toLowerCase() : '';
    if (!email || email.length > 320) {
      throw new Error('invalid verification email');
    }
    if (
      typeof parsed.resendAvailableAt !== 'number' ||
      !Number.isFinite(parsed.resendAvailableAt) ||
      parsed.resendAvailableAt < 0 ||
      (parsed.delivered !== null && typeof parsed.delivered !== 'boolean')
    ) {
      throw new Error('invalid verification context');
    }
    const owner = currentVerifyContextOwner();
    const storedOwner = parsed.owner;
    const legacyAnonymousContext =
      storedOwner === undefined && owner.userId.length === 0 && owner.householdId.length === 0;
    if (
      !legacyAnonymousContext &&
      (!storedOwner ||
        typeof storedOwner.userId !== 'string' ||
        typeof storedOwner.householdId !== 'string' ||
        Object.keys(storedOwner).some((key) => !OWNER_KEYS.has(key)))
    ) {
      throw new Error('invalid verification owner');
    }
    const expiresAt = parsed.expiresAt ?? null;
    if (
      expiresAt !== null &&
      (typeof expiresAt !== 'number' ||
        !Number.isFinite(expiresAt) ||
        expiresAt < 0 ||
        expiresAt > MAX_DATE_MS)
    ) {
      throw new Error('invalid verification expiry');
    }
    if (
      storedOwner &&
      (storedOwner.userId !== owner.userId || storedOwner.householdId !== owner.householdId)
    ) {
      throw new Error('verification owner changed');
    }
    const context: VerifyContext = {
      email,
      resendAvailableAt: parsed.resendAvailableAt,
      expiresAt,
      delivered: parsed.delivered,
      owner,
    };
    if (legacyAnonymousContext || parsed.expiresAt === undefined) {
      try {
        store?.setItem(VERIFY_CONTEXT_KEY, JSON.stringify(context));
      } catch {
        // The validated in-memory context is still usable for this render.
      }
    }
    return context;
  } catch {
    removeStoredContext(store);
    return null;
  }
}

export function writeVerifyContext(context: VerifyContextInput): VerifyContext | null {
  const email = context.email.trim().toLowerCase();
  if (
    !email ||
    email.length > 320 ||
    !Number.isFinite(context.resendAvailableAt) ||
    context.resendAvailableAt < 0
  ) {
    return null;
  }
  const expiresAt = context.expiresAt ?? null;
  if (
    expiresAt !== null &&
    (!Number.isFinite(expiresAt) || expiresAt < 0 || expiresAt > MAX_DATE_MS)
  ) {
    return null;
  }
  const sanitized: VerifyContext = {
    email,
    resendAvailableAt: context.resendAvailableAt,
    expiresAt,
    delivered: context.delivered === null ? null : context.delivered === true,
    owner: currentVerifyContextOwner(),
  };
  try {
    sessionStore()?.setItem(VERIFY_CONTEXT_KEY, JSON.stringify(sanitized));
  } catch {
    // The route still works in-memory; refresh recovery is unavailable.
  }
  return sanitized;
}

export function clearVerifyContext(): void {
  removeStoredContext();
}

export function resendSecondsRemaining(context: VerifyContext | null, now = Date.now()): number {
  if (!context) return 0;
  return Math.max(0, Math.ceil((context.resendAvailableAt - now) / 1000));
}
