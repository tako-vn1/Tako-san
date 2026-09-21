import { test, expect } from '@playwright/test';

const CONTEXT_KEY = 'frigo_auth_verify_context';

test('T18A real Worker resend expiry survives refresh with safe presentation metadata', async ({ page }, info) => {
  await page.goto('/auth?mode=register');
  await page.getByLabel('Họ và tên', { exact: false }).fill('OTP Contract Test');
  await page.getByLabel('Email', { exact: true }).fill(`t18a-${info.project.name}@example.test`);
  await page.getByLabel('Mật khẩu', { exact: false }).first().fill('synthetic-password-1');
  await page.getByRole('button', { name: 'Tạo tài khoản & Nhận mã OTP' }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await expect(page.getByTestId('otp-expiry')).toContainText('Mã hết hạn lúc');

  // Only advance the client presentation cooldown; the real Worker still enforces its policy.
  await page.evaluate((key) => {
    const context = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify({ ...context, resendAvailableAt: 0, expiresAt: null }));
  }, CONTEXT_KEY);
  await page.reload();
  await expect(page.getByTestId('otp-expiry')).toContainText('Máy chủ chưa cung cấp thời hạn cho mã này');
  const startedAt = Date.now();
  const pendingResponse = page.waitForResponse('**/auth/resend-otp');
  await page.getByRole('button', { name: 'Gửi lại mã OTP', exact: true }).click();
  const response = await pendingResponse;
  expect(response.status()).toBe(200);
  const { expiresInMinutes } = await response.json();
  expect(expiresInMinutes).toBe(10);
  await expect(page.getByTestId('otp-expiry')).toContainText('Mã hết hạn lúc');
  await expect(page.getByRole('button', { name: /Gửi lại sau/ })).toBeDisabled();
  const context = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), CONTEXT_KEY);
  expect(context.expiresAt).toBeGreaterThanOrEqual(startedAt + expiresInMinutes * 60_000);
  expect(context.expiresAt).toBeLessThanOrEqual(Date.now() + expiresInMinutes * 60_000);
  expect(context.delivered).toBeNull();
  expect(Object.keys(context).sort()).toEqual(['delivered', 'email', 'expiresAt', 'owner', 'resendAvailableAt']);

  await page.reload();
  await expect(page.getByTestId('otp-expiry')).toContainText('Mã hết hạn lúc');
  expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), CONTEXT_KEY)).toEqual(context);
  await expect(page.getByRole('group', { name: 'Mã OTP 6 chữ số' }).getByRole('textbox').first()).toHaveValue('');
  await expect(page.getByText('Mã OTP Thử nghiệm:', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('t18a-resend-expiry-restored.png'), fullPage: true });
});

for (const outcome of ['malformed', 'delivery-unavailable', 'offline'] as const) {
  test(`T18A ${outcome} resend discards the old expiry without inventing delivery`, async ({ page }) => {
    await page.goto('/auth');
    await page.evaluate((key) => {
      sessionStorage.setItem(key, JSON.stringify({
        email: 't18a-failure@example.test',
        resendAvailableAt: 0,
        expiresAt: Date.now() + 600_000,
        delivered: true,
        owner: { userId: '', householdId: '' },
      }));
    }, CONTEXT_KEY);
    await page.route('**/auth/resend-otp', async (route) => {
      if (outcome === 'offline') return route.abort('internetdisconnected');
      await route.fulfill({
        status: outcome === 'malformed' ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(outcome === 'malformed'
          ? { success: true, message: 'Đã gửi lại mã OTP mới.' }
          : { success: false, error: 'Email OTP chưa gửi được.', code: 'OTP_DELIVERY_UNAVAILABLE' }),
      });
    });
    await page.goto('/auth/verify');
    await page.getByRole('button', { name: 'Gửi lại mã OTP', exact: true }).click();
    const expiry = page.getByTestId('otp-expiry');
    await expect(expiry).toContainText(outcome === 'delivery-unavailable'
      ? 'Chưa có mã đang hoạt động vì email OTP chưa gửi được'
      : 'Máy chủ chưa cung cấp thời hạn cho mã này');
    const context = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), CONTEXT_KEY);
    expect(context.expiresAt).toBeNull();
    expect(context.delivered).toBe(outcome === 'malformed' ? true : outcome === 'offline' ? null : false);
    if (outcome !== 'malformed') {
      await expect(page.getByRole('button', { name: 'Gửi lại mã OTP', exact: true })).toBeEnabled();
      await expect(page.getByRole('alert')).toBeVisible();
    }
  });
}
