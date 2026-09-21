// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreatedPaymentIntent, PaymentIntent, PlusPrice } from '../../src/shared/payment';

const mocks = vi.hoisted(() => {
  const authState = {
    userId: 'payment-user',
    householdId: 'payment-household',
    displayName: 'Payment User',
    email: 'payment@example.test',
    isGuest: false,
    isPlus: false,
    avatarUrl: undefined,
    syncPlusFromServer: vi.fn(async () => undefined),
    setPlusFromServer: vi.fn(),
  };
  const useAuthStore = Object.assign(
    (selector?: (state: typeof authState) => unknown) => selector ? selector(authState) : authState,
    { getState: () => authState },
  );
  return {
    authState,
    useAuthStore,
    getPlans: vi.fn(),
    createPaymentIntent: vi.fn(),
    getPaymentIntent: vi.fn(),
    getMe: vi.fn(),
    resetListeners: new Set<() => void>(),
  };
});

vi.mock('../../src/web/stores/useAuthStore', () => ({ useAuthStore: mocks.useAuthStore }));
vi.mock('../../src/web/services/billing', () => ({
  billingApi: {
    getPlans: mocks.getPlans,
    createPaymentIntent: mocks.createPaymentIntent,
    getPaymentIntent: mocks.getPaymentIntent,
  },
}));
vi.mock('../../src/web/services/api', () => ({
  api: { getPaymentIntent: mocks.getPaymentIntent, getMe: mocks.getMe },
}));
vi.mock('../../src/web/lib/private-session', () => ({
  capturePrivateSession: () => () => true,
  clearPrivateIdentity: () => {
    for (const key of ['frigo_user_id', 'frigo_household_id', 'frigo_email', 'frigo_display_name',
      'frigo_avatar_url', 'frigo_is_plus', 'frigo_onboarded', 'frigo_is_guest']) {
      localStorage.removeItem(key);
    }
  },
  currentPrivateScope: () => ({
    userId: localStorage.getItem('frigo_user_id') || '',
    householdId: localStorage.getItem('frigo_household_id') || '',
  }),
  isOfflineGuestSession: () => false,
  privateSessionBlocked: () => false,
  removeLegacyPrivateCaches: vi.fn(),
  resetPrivateSession: () => {
    mocks.resetListeners.forEach((listener) => listener());
  },
  LOGOUT_PENDING_KEY: 'frigo_logout_pending',
  LOGOUT_WARNING: 'logout not confirmed',
  OFFLINE_GUEST_KEY: 'frigo_guest_offline',
  onPrivateSessionReset: (listener: () => void) => {
    mocks.resetListeners.add(listener);
    return () => mocks.resetListeners.delete(listener);
  },
}));

import { PlusPaywallPage } from '../../src/web/pages/PlusPaywallPage';
import { VietQRModal } from '../../src/web/components/payment/VietQRModal';

const prices: PlusPrice[] = [
  { plan: 'monthly', amountVnd: 654321, currency: 'VND' },
  { plan: 'annual', amountVnd: 7654321, currency: 'VND' },
];

const createdIntent = (changes: Partial<CreatedPaymentIntent> = {}): CreatedPaymentIntent => ({
  id: 'pay_fixture',
  orderCode: 'order_fixture',
  plan: 'annual',
  amountVnd: 7654321,
  currency: 'VND',
  description: 'Server payment fixture',
  expiresAt: '2099-01-01T00:00:00.000Z',
  status: 'pending',
  instructions: {
    bankBin: 'SERVER-BANK',
    accountNumber: '123456789',
    accountName: 'SERVER ACCOUNT',
    transferContent: 'SERVER-CONTENT',
    qrImageUrl: 'https://server.test/qr/pay_fixture.png',
  },
  ...changes,
});

const payment = (changes: Partial<PaymentIntent> = {}): PaymentIntent => {
  const intent = createdIntent(changes);
  const { instructions: _instructions, ...result } = intent;
  return result;
};

describe('server-authoritative payment checkout', () => {
  let root: Root | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    mocks.authState.userId = 'payment-user';
    mocks.authState.householdId = 'payment-household';
    mocks.authState.isGuest = false;
    mocks.authState.isPlus = false;
    mocks.authState.setPlusFromServer.mockReset();
    mocks.authState.syncPlusFromServer.mockReset();
    mocks.getPlans.mockReset();
    mocks.createPaymentIntent.mockReset();
    mocks.getPaymentIntent.mockReset();
    mocks.getMe.mockReset();
    mocks.resetListeners.clear();
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment() });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host.remove();
    mocks.resetListeners.clear();
    vi.restoreAllMocks();
  });

  async function mount(ui: React.ReactElement) {
    await act(async () => {
      root = createRoot(host);
      root.render(ui);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('renders arbitrary server prices and uses the selected plan without a client amount', async () => {
    mocks.getPlans.mockResolvedValue({ plans: prices });
    mocks.createPaymentIntent.mockResolvedValue({ success: true, payment: createdIntent() });
    await mount(<MemoryRouter><PlusPaywallPage /></MemoryRouter>);
    await vi.waitFor(() => expect(host.textContent).toContain('7.654.321 VND'));

    expect(host.textContent).toContain('654.321 VND');
    expect(host.textContent).toContain('7.654.321 VND');
    expect(host.textContent).not.toContain('599.000');
    expect(host.textContent).not.toContain('79.000');

    const annual = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Gói 1 Năm'));
    expect(annual).toBeDefined();
    await act(async () => { annual?.click(); await Promise.resolve(); });
    const buy = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Nâng cấp ngay với'));
    expect(buy).toBeDefined();
    await act(async () => { buy?.click(); await Promise.resolve(); });

    expect(mocks.createPaymentIntent).toHaveBeenCalledExactlyOnceWith('annual');
    expect(host.querySelector('img[alt="Mã VietQR"]')?.getAttribute('src')).toBe('https://server.test/qr/pay_fixture.png');
    expect(host.textContent).toContain('7.654.321 VND');
    expect(host.textContent).toContain('SERVER-CONTENT');
  });

  it('allows a new plan request after switching plans and ignores the older response', async () => {
    let resolveAnnual!: (value: { success: true; payment: CreatedPaymentIntent }) => void;
    let resolveMonthly!: (value: { success: true; payment: CreatedPaymentIntent }) => void;
    mocks.getPlans.mockResolvedValue({ plans: prices });
    mocks.createPaymentIntent.mockImplementation((plan: PlusPrice['plan']) => new Promise((resolve) => {
      if (plan === 'annual') resolveAnnual = resolve;
      else resolveMonthly = resolve;
    }));
    await mount(<MemoryRouter><PlusPaywallPage /></MemoryRouter>);
    await vi.waitFor(() => expect(host.textContent).toContain('7.654.321 VND'));

    const buy = () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Nâng cấp ngay với'));
    await act(async () => { buy()?.click(); await Promise.resolve(); });
    expect(mocks.createPaymentIntent).toHaveBeenCalledWith('annual');

    const monthly = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Gói 1 Tháng'));
    await act(async () => { monthly?.click(); await Promise.resolve(); });
    await act(async () => { buy()?.click(); await Promise.resolve(); });
    expect(mocks.createPaymentIntent).toHaveBeenCalledWith('monthly');

    await act(async () => {
      resolveAnnual({ success: true, payment: createdIntent({ plan: 'annual', amountVnd: 7654321 }) });
      await Promise.resolve();
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      resolveMonthly({
        success: true,
        payment: createdIntent({ plan: 'monthly', amountVnd: 654321, orderCode: 'monthly-order' }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain('654.321 VND');
  });

  it('rejects a created intent whose server plan differs from the selected plan', async () => {
    mocks.getPlans.mockResolvedValue({ plans: prices });
    mocks.createPaymentIntent.mockResolvedValue({
      success: true,
      payment: createdIntent({ plan: 'monthly', amountVnd: 654321 }),
    });
    await mount(<MemoryRouter><PlusPaywallPage /></MemoryRouter>);
    await vi.waitFor(() => expect(host.textContent).toContain('7.654.321 VND'));

    const buy = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Nâng cấp ngay với'));
    await act(async () => { buy?.click(); await Promise.resolve(); });

    await vi.waitFor(() => expect(host.textContent).toContain('Không thể tạo lệnh thanh toán. Vui lòng thử lại.'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each([
    ['failed', 'Thanh toán thất bại'],
    ['expired', 'Lệnh thanh toán đã hết hạn'],
    ['refunded', 'Thanh toán đã hoàn tiền'],
  ] as const)('keeps %s status honest and does not unlock Plus', async (status, text) => {
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment({ status }) });
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} intent={createdIntent()} />);
    expect(host.textContent).toContain(text);
    expect(host.textContent).not.toContain('Thanh toán thành công');
    expect(mocks.authState.setPlusFromServer).not.toHaveBeenCalled();
  });

  it('keeps pending and offline states honest', async () => {
    mocks.getPaymentIntent.mockRejectedValue(new Error('offline'));
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} intent={createdIntent()} />);
    expect(host.textContent).toContain('Đang chờ thanh toán');
    expect(host.textContent).toContain('Không thể kiểm tra trạng thái với máy chủ');
    expect(host.textContent).not.toContain('Thanh toán thành công');
  });

  it('does not unlock when the server reports paid but /me reports isPlus false', async () => {
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment({ status: 'paid' }) });
    mocks.getMe.mockResolvedValue({ user: { id: 'payment-user', isPlus: false } });
    const onSuccess = vi.fn();
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={onSuccess} intent={createdIntent()} />);
    await vi.waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    expect(mocks.authState.setPlusFromServer).toHaveBeenCalledWith(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Đã nhận thanh toán');
    expect(host.textContent).not.toContain('Thanh toán thành công');
  });

  it('can recover entitlement after a false /me response through a manual retry', async () => {
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment({ status: 'paid' }) });
    mocks.getMe
      .mockResolvedValueOnce({ user: { id: 'payment-user', isPlus: false } })
      .mockResolvedValueOnce({ user: { id: 'payment-user', isPlus: true } });
    const onSuccess = vi.fn();
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={onSuccess} intent={createdIntent()} />);

    await vi.waitFor(() => expect(mocks.getMe).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
    const retry = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Kiểm tra trạng thái'));
    expect(retry).toBeDefined();
    await act(async () => { retry?.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(mocks.getMe).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not show success while paid entitlement verification is still pending', async () => {
    let resolveMe!: (value: unknown) => void;
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment({ status: 'paid' }) });
    mocks.getMe.mockReturnValue(new Promise((resolve) => { resolveMe = resolve; }));
    const onSuccess = vi.fn();
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={onSuccess} intent={createdIntent()} />);

    await vi.waitFor(() => expect(mocks.getMe).toHaveBeenCalledWith({ requireServer: true }));
    expect(host.textContent).toContain('Đã nhận thanh toán; đang kiểm tra quyền lợi');
    expect(host.textContent).not.toContain('Thanh toán thành công');
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      resolveMe({ user: { id: 'payment-user', isPlus: true } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not apply entitlement from /me when the returned user is different', async () => {
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment({ status: 'paid' }) });
    mocks.getMe.mockResolvedValue({ user: { id: 'other-user', isPlus: true } });
    const onSuccess = vi.fn();
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={onSuccess} intent={createdIntent()} />);

    await vi.waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    expect(mocks.authState.setPlusFromServer).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Đã nhận thanh toán');
    expect(host.textContent).toContain('Không thể xác minh quyền lợi');
  });

  it('keeps paid-but-unavailable honest when /me cannot reload benefits', async () => {
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment({ status: 'paid' }) });
    mocks.getMe.mockRejectedValue(new Error('network down'));
    const onSuccess = vi.fn();
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={onSuccess} intent={createdIntent()} />);

    await vi.waitFor(() => expect(mocks.getMe).toHaveBeenCalled());
    expect(host.textContent).toContain('Đã nhận thanh toán; chưa thể tải lại quyền lợi Plus');
    expect(host.textContent).not.toContain('Thanh toán thành công');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does not replace the displayed payment with a response for another intent', async () => {
    mocks.getPaymentIntent.mockResolvedValue({
      success: true,
      payment: payment({ id: 'other-payment', amountVnd: 1, orderCode: 'other-order' }),
    });
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} intent={createdIntent()} />);

    await vi.waitFor(() => expect(host.textContent).toContain('Trạng thái thanh toán không khớp với lệnh này'));
    expect(host.textContent).toContain('7.654.321 VND');
    expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('VND'))?.textContent)
      .toContain('7.654.321 VND');
  });

  it('reloads server entitlement before showing success', async () => {
    mocks.getPaymentIntent.mockResolvedValue({ success: true, payment: payment({ status: 'paid' }) });
    mocks.getMe.mockResolvedValue({ user: { id: 'payment-user', isPlus: true } });
    const onSuccess = vi.fn();
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={onSuccess} intent={createdIntent()} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.getMe).toHaveBeenCalledWith({ requireServer: true });
    expect(mocks.authState.setPlusFromServer).toHaveBeenCalledWith(true);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not apply a stale paid response after the private session resets', async () => {
    let resolveStatus!: (value: { success: true; payment: PaymentIntent }) => void;
    mocks.getPaymentIntent.mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));
    const onSuccess = vi.fn();
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={onSuccess} intent={createdIntent()} />);
    await act(async () => {
      mocks.resetListeners.forEach((listener) => listener());
      resolveStatus({ success: true, payment: payment({ status: 'paid' }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.authState.setPlusFromServer).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Phiên tài khoản đã thay đổi');
  });

  it('masks the old intent immediately when the authenticated owner changes', async () => {
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} intent={createdIntent()} />);
    mocks.authState.userId = 'other-user';
    mocks.authState.householdId = 'other-household';
    await act(async () => {
      root?.render(<VietQRModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} intent={createdIntent()} />);
      await Promise.resolve();
    });

    expect(host.querySelector('img[alt="Mã VietQR"]')).toBeNull();
    expect(host.textContent).toContain('Phiên tài khoản đã thay đổi');
  });

  it('single-flights manual status checks while the initial request is pending', async () => {
    let resolveStatus!: (value: { success: true; payment: PaymentIntent }) => void;
    mocks.getPaymentIntent.mockReturnValue(new Promise((resolve) => { resolveStatus = resolve; }));
    await mount(<VietQRModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} intent={createdIntent()} />);
    const check = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Kiểm tra trạng thái'));
    await act(async () => {
      check?.click();
      check?.click();
    });
    expect(mocks.getPaymentIntent).toHaveBeenCalledOnce();
    await act(async () => {
      resolveStatus({ success: true, payment: payment() });
      await Promise.resolve();
    });
  });
});

describe('server-only Plus entitlement hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('frigo_user_id', 'payment-user');
    localStorage.setItem('frigo_household_id', 'payment-household');
    localStorage.setItem('frigo_email', 'payment@example.test');
    localStorage.setItem('frigo_is_guest', 'false');
    mocks.getMe.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
    mocks.resetListeners.clear();
    vi.resetModules();
  });

  async function loadRealAuthStore() {
    vi.resetModules();
    const module = await vi.importActual<typeof import('../../src/web/stores/useAuthStore')>(
      '../../src/web/stores/useAuthStore',
    );
    return module.useAuthStore;
  }

  it('ignores a tampered cached Plus flag until /me confirms entitlement', async () => {
    localStorage.setItem('frigo_is_plus', 'true');
    mocks.getMe.mockResolvedValue({
      user: { id: 'payment-user', isPlus: false, subscription: { plan: 'free' } },
    });
    const authStore = await loadRealAuthStore();

    expect(authStore.getState().isPlus).toBe(false);
    await authStore.getState().syncPlusFromServer();

    expect(mocks.getMe).toHaveBeenCalledWith({ requireServer: true });
    expect(authStore.getState().isPlus).toBe(false);
    expect(localStorage.getItem('frigo_is_plus')).toBe('false');
  });

  it('does not treat an expired server Plus subscription as an entitlement', async () => {
    localStorage.setItem('frigo_is_plus', 'true');
    mocks.getMe.mockResolvedValue({
      user: {
        id: 'payment-user',
        isPlus: false,
        subscription: { plan: 'plus', status: 'active', expiresAt: '2020-01-01T00:00:00.000Z' },
      },
    });
    const authStore = await loadRealAuthStore();

    await authStore.getState().syncPlusFromServer();

    expect(authStore.getState().isPlus).toBe(false);
    expect(localStorage.getItem('frigo_is_plus')).toBe('false');
  });
});
