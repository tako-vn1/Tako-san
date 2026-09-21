import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, reset } from '../t13b/fixtures';
import type { Page } from '@playwright/test';
import { spaCsp } from '../../../src/worker/config/csp';

type Plan = 'monthly' | 'annual';
type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';
type FailureMode = 'unavailable' | 'offline';

const displayPrices: Record<Plan, number> = { monthly: 12_345, annual: 67_890 };
const intentPrices: Record<Plan, number> = { monthly: 49_000, annual: 499_000 };
const syntheticQr =
  '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220"><rect width="220" height="220" fill="#fff"/><path d="M10 10h60v60H10zM25 25h30v30H25zM150 10h60v60h-60zM165 25h30v30h-30zM10 150h60v60H10zM25 165h30v30H25zM95 20h20v20H95zM85 85h20v20H85zM120 100h20v20h-20zM90 145h30v20H90zM145 145h20v30h-20zM180 100h20v20h-20z" fill="#123b32"/></svg>';

interface MockState {
  status: PaymentStatus;
  entitled: boolean;
  intent: Plan | null;
  createdPlans: Plan[];
  intentReads: string[];
  qrRequests: string[];
  entitlementReads: number;
}

function payment(plan: Plan, status: PaymentStatus) {
  const id = `pay_${plan}_authority`;
  const orderCode = plan === 'annual' ? '180001' : '180002';
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  return {
    id,
    orderCode,
    plan,
    amountVnd: intentPrices[plan],
    currency: 'VND' as const,
    description: `TP${orderCode}`,
    expiresAt,
    status,
    instructions: {
      bankBin: '970415',
      accountNumber: '0123456789',
      accountName: 'TAKOSAN TEST',
      transferContent: `TP${orderCode}`,
      qrImageUrl: `https://img.vietqr.io/image/970415-0123456789-compact2.png?amount=${intentPrices[plan]}&addInfo=${encodeURIComponent(`TP${orderCode}`)}&accountName=${encodeURIComponent('TAKOSAN TEST')}`,
    },
  };
}

async function json(
  route: Parameters<Parameters<Page['route']>[1]>[0],
  body: unknown,
  status = 200,
) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installPaymentMocks(
  page: Page,
  options: {
    status?: PaymentStatus;
    entitled?: boolean;
    entitleOnCreate?: boolean;
    failure?: FailureMode;
  } = {},
): Promise<MockState> {
  const state: MockState = {
    status: options.status ?? 'pending',
    entitled: options.entitled ?? false,
    intent: null,
    createdPlans: [],
    intentReads: [],
    qrRequests: [],
    entitlementReads: 0,
  };

  // Vite does not serve production headers; enforce the real image policy here.
  const imagePolicy = spaCsp().match(/img-src [^;]+/)?.[0];
  if (!imagePolicy) throw new Error('Missing production image policy');
  await page.route('**/plus', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': imagePolicy },
    });
  });

  await page.route('**/api/v1/billing/plans', async (route) => {
    await json(route, {
      plans: (['monthly', 'annual'] as const).map((plan) => ({
        plan,
        amountVnd: displayPrices[plan],
        currency: 'VND',
      })),
    });
  });

  await page.route('**/api/v1/billing/payment-intents', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    if (options.failure === 'offline') return route.abort('internetdisconnected');
    if (options.failure === 'unavailable') {
      return json(
        route,
        { error: 'Thanh toán tạm thời chưa khả dụng', code: 'PAYMENT_UNAVAILABLE' },
        503,
      );
    }
    const body = route.request().postDataJSON() as { plan?: Plan };
    if (body.plan !== 'monthly' && body.plan !== 'annual')
      throw new Error('Payment mock received an invalid plan');
    state.intent = body.plan;
    state.createdPlans.push(body.plan);
    if (options.entitleOnCreate) state.entitled = true;
    await json(route, { success: true, payment: payment(body.plan, 'pending') }, 201);
  });

  await page.route('**/api/v1/billing/payment-intents/*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    state.intentReads.push(id);
    if (!state.intent) throw new Error('Payment status read arrived before intent creation');
    const current = payment(state.intent, state.status);
    const { instructions: _instructions, ...view } = current;
    await json(route, { success: true, payment: view });
  });

  await page.route('**/api/v1/me', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.entitlementReads += 1;
    await json(route, {
      user: {
        id: 'planner-preview-user',
        email: 'planner-preview@example.test',
        displayName: 'Planner Preview',
        isGuest: false,
        isPlus: state.entitled,
        onboardingCompleted: true,
        household: { id: 'planner-preview-household', name: 'Tủ lạnh thử nghiệm' },
        subscription: state.entitled ? { plan: 'plus', status: 'active' } : null,
      },
    });
  });

  // The shared fixture blocks all external network. This is a harmless local
  // image response for the provider-owned URL returned by the payment mock.
  await page.route('https://img.vietqr.io/image/**', async (route) => {
    state.qrRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: syntheticQr });
  });

  return state;
}

async function openPlus(page: Page, options?: Parameters<typeof installPaymentMocks>[1]) {
  await reset(page);
  const state = await installPaymentMocks(page, options);
  await page.goto('/plus');
  await expect(page.getByRole('heading', { name: 'Nâng cấp Takosan Plus' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Gói 1 Tháng/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Gói 1 Năm/ })).toBeVisible();
  return state;
}

test('server intent amount and selected plan drive the VietQR payment surface', async ({
  page,
}, info) => {
  const state = await openPlus(page);
  const plans: Plan[] = info.project.name === 'desktop-1440' ? ['monthly'] : ['annual'];

  for (const plan of plans) {
    const planName = plan === 'annual' ? 'Gói 1 Năm' : 'Gói 1 Tháng';
    const displayAmount = displayPrices[plan].toLocaleString('vi-VN');
    const intentAmount = intentPrices[plan].toLocaleString('vi-VN');
    await page.getByRole('button', { name: new RegExp(planName) }).click();
    await expect(page.getByRole('button', { name: /Nâng cấp ngay với/ })).toContainText(
      `${displayAmount} VND`,
    );
    await page.getByRole('button', { name: /Nâng cấp ngay với/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      `${plan === 'annual' ? 'Gói 1 Năm' : 'Gói 1 Tháng'} Takosan Plus`,
    );
    await expect(dialog.getByText(`${intentAmount} VND`, { exact: true })).toBeVisible();
    await expect(dialog.getByText(`${displayAmount} VND`, { exact: true })).toHaveCount(0);
    const qrImage = dialog.getByRole('img', { name: 'Mã VietQR' });
    await expect(qrImage).toBeVisible();
    await expect.poll(() => qrImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(state.createdPlans).toContain(plan);
    await expect.poll(() => state.intentReads).toContain(`pay_${plan}_authority`);
    await expect.poll(() => state.qrRequests).not.toHaveLength(0);
    const qrUrl = new URL(state.qrRequests.at(-1)!);
    expect(qrUrl.hostname).toBe('img.vietqr.io');
    expect(qrUrl.searchParams.get('amount')).toBe(String(intentPrices[plan]));
    expect(qrUrl.searchParams.get('addInfo')).toBe(`TP${plan === 'annual' ? '180001' : '180002'}`);
    expect(qrUrl.searchParams.get('accountName')).toBe('TAKOSAN TEST');

    if (
      (info.project.name === 'mobile-390' && plan === 'annual') ||
      (info.project.name === 'desktop-1440' && plan === 'monthly')
    ) {
      await page.screenshot({
        path: info.outputPath(`payment-authority-${info.project.name}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'Đóng' }).click();
    await expect(dialog).toBeHidden();
  }
});

test('pending payment stays manual and closing it grants nothing', async ({ page }) => {
  const state = await openPlus(page);
  await page.getByRole('button', { name: /Gói 1 Tháng/ }).click();
  await page.getByRole('button', { name: /Nâng cấp ngay với/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Đang chờ thanh toán');
  await expect(dialog.getByRole('img', { name: 'Mã VietQR' })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Kiểm tra trạng thái thanh toán' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Đóng' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/plus$/);
  expect(state.entitled).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('frigo_is_plus'))).not.toBe('true');
});

test('T18C payment dialog traps keyboard focus and Escape returns focus without granting Plus', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await openPlus(page);
  const trigger = page.getByRole('button', { name: /Nâng cấp ngay với/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Thanh toán VietQR' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleName('Thanh toán VietQR');
  expect(await dialog.evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  const countdown = dialog.getByText(/^\d+:\d{2}$/);
  await expect(countdown).toBeVisible();
  expect(await countdown.evaluate((element) => element.closest('[aria-live="polite"], [role="status"], [role="alert"]'))).toBeNull();
  await expect(dialog.getByRole('status')).toContainText('Đang chờ thanh toán');
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  await writeFile(info.outputPath('payment-a11y.json'), JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }, null, 2));
  expect(axe.violations.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
  await expect(dialog.getByRole('button', { name: 'Đóng', exact: true })).toBeFocused();
  for (const key of ['Shift+Tab', ...Array<string>(12).fill('Tab')]) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await expect(trigger).toBeFocused();
  expect(state.entitled).toBe(false);
  await expect(page.getByText('Bạn là hội viên Plus', { exact: true })).toHaveCount(0);
});

for (const terminalStatus of ['failed', 'expired'] as const) {
  test(`${terminalStatus} payment has no QR or manual success path`, async ({ page }) => {
    await openPlus(page, { status: terminalStatus });
    await page.getByRole('button', { name: /Gói 1 Năm/ }).click();
    await page.getByRole('button', { name: /Nâng cấp ngay với/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(
      terminalStatus === 'failed' ? 'Thanh toán thất bại' : 'Lệnh thanh toán đã hết hạn',
    );
    await expect(dialog.getByRole('img', { name: 'Mã VietQR' })).toHaveCount(0);
    await expect(
      dialog.getByRole('button', { name: 'Kiểm tra trạng thái thanh toán' }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/\/plus$/);
  });
}

for (const failure of ['unavailable', 'offline'] as const) {
  test(`${failure} checkout does not fabricate a QR instruction`, async ({ page }) => {
    const state = await openPlus(page, { failure });
    await page.getByRole('button', { name: /Gói 1 Tháng/ }).click();
    await page.getByRole('button', { name: /Nâng cấp ngay với/ }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Không thể tạo lệnh thanh toán. Vui lòng thử lại.',
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Mã VietQR' })).toHaveCount(0);
    expect(state.createdPlans).toEqual([]);
  });
}

test('paid status still waits for a fresh Plus entitlement from /me', async ({ page }) => {
  const state = await openPlus(page, { status: 'paid', entitled: false });
  await page.getByRole('button', { name: /Gói 1 Năm/ }).click();
  await page.getByRole('button', { name: /Nâng cấp ngay với/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Đã nhận thanh toán');
  await expect(dialog).not.toContainText('Thanh toán thành công');
  await expect(page).toHaveURL(/\/plus$/);
  expect(state.entitlementReads).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('frigo_is_plus'))).not.toBe('true');
});

test('success requires paid status and a fresh /me response with isPlus true', async ({ page }) => {
  const state = await openPlus(page, { status: 'paid', entitleOnCreate: true });
  await page.getByRole('button', { name: /Gói 1 Năm/ }).click();
  await page.getByRole('button', { name: /Nâng cấp ngay với/ }).click();
  await expect(page).toHaveURL(/\/me$/, { timeout: 10_000 });
  expect(state.entitlementReads).toBeGreaterThan(0);
  await expect(page.getByText('VIP Plus', { exact: true })).toBeVisible();
});
