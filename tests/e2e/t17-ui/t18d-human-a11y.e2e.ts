import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, reset, control, getJson } from '../t13b/fixtures';

type ScanItem = {
  id: string;
  rawName: string;
  estimatedQuantity: number;
  unit: string;
  storage: string;
  reviewState: string;
  rejected?: boolean;
};

type ScanEnvelope = {
  scan: {
    id: string;
    status: 'pending' | 'ready' | 'confirmed' | 'failed';
    items: ScanItem[];
    errorCode?: string;
  };
};

type RecipeEnvelope = {
  recipe: {
    id: string;
    slug: string;
    steps: Array<{ instruction: string; timerMinutes?: number | null }>;
  };
};

const RECIPE_SLUG = 'canh-chua-ca-loc-nam-bo';

test.afterEach(async ({ page }, info) => {
  await info.attach('accessibility-tree', { body: await page.locator('main').ariaSnapshot(), contentType: 'text/plain' });
});

async function strictAxe(page: Page) {
  expect(await page.locator('[role="status"], [aria-live]').evaluateAll((nodes) =>
    nodes.filter((node) => node.parentElement?.closest('[role="status"], [aria-live]')).length,
  ), 'no nested live announcement sources').toBe(0);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations, result.violations.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
}

async function seedScanRoute(page: Page, id: string, statuses: ScanEnvelope['scan']['status'][], hold = false) {
  let call = 0;
  let release = () => {};
  const ready = new Promise<void>((resolve) => { release = resolve; });
  if (!hold) release();
  await page.route(`**/api/v1/scans/${id}`, async (route) => {
    const origin = new URL(route.request().url()).origin;
    const response = await route.fetch({ url: `${origin}/api/v1/scans/t13b-preview-fridge` });
    const body = await response.json() as ScanEnvelope;
    const status = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    await ready;
    body.scan.id = id;
    body.scan.status = status;
    body.scan.errorCode = status === 'failed' ? 'AI_SCAN_TIMEOUT' : undefined;
    await route.fulfill({ response, json: body });
  });
  return release;
}

async function observeLiveChanges(page: Page, selector: string) {
  await page.locator(selector).evaluate((node) => {
    node.setAttribute('data-live-changes', '0');
    new MutationObserver((records) => {
      const changes = Number(node.getAttribute('data-live-changes'));
      node.setAttribute('data-live-changes', String(changes + records.length));
    }).observe(node, { childList: true, characterData: true, subtree: true });
  });
}

async function prepareScan(page: Page, id: string) {
  await reset(page);
  await control(page, 't13-scans');
  await page.goto(`/scan/${id}/review`);
}

async function expectOnlySelectedRecipeTab(page: Page, label: string, panelId: string) {
  const tabs = page.getByRole('tab');
  const selected = page.getByRole('tab', { name: label, exact: true });
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(selected).toHaveAttribute('tabindex', '0');
  for (const tab of await tabs.all()) {
    if (await tab.getAttribute('id') !== await selected.getAttribute('id')) {
      await expect(tab).toHaveAttribute('aria-selected', 'false');
      await expect(tab).toHaveAttribute('tabindex', '-1');
    }
  }
  await expect(selected).toHaveAttribute('aria-controls', panelId);
  const panel = page.locator(`#${panelId}`);
  await expect(panel).toHaveAttribute('role', 'tabpanel');
  await expect(panel).toHaveAttribute('aria-labelledby', await selected.getAttribute('id') || '');
  await expect(panel).toBeVisible();
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(3);
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  for (const tab of await tabs.all()) {
    await expect(page.locator(`#${await tab.getAttribute('aria-controls')}`)).toHaveCount(1);
  }
}

test.describe('T18D scan announcements', () => {
  test('capture stages change meaningfully and failed uploads cannot restart delayed announcements', async ({ page }) => {
    await reset(page);
    let release = () => {};
    const result = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/v1/scans/fridge', async (route) => {
      await result;
      await route.fulfill({ status: 400, json: { code: 'INVALID_RESPONSE', error: 'Ảnh chưa đủ rõ.' } });
    });
    await page.goto('/scan');
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.locator('input[type="file"]').setInputFiles('public/takosan/app-icons/icon-192.png');
    const processing = page.getByTestId('scan-processing-state');
    const status = processing.getByRole('status');
    await expect(status).toHaveText('Đã nhận ảnh.');
    await page.clock.runFor(450);
    await expect(status).toHaveText('Đã xếp hàng xử lý.');
    await expect(processing.locator('[role="status"], [aria-live]')).toHaveCount(1);
    release();
    await expect(page.getByRole('alert')).toContainText('Ảnh');
    await expect(processing).toHaveCount(0);
    await page.clock.runFor(4000);
    await expect(processing).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thử lại', exact: true })).toBeEnabled();
    await page.clock.resume();
    await strictAxe(page);
  });

  test('processing elapsed time is outside the stage live region and does not announce every second', async ({ page }) => {
    const id = 't18d-processing-noise';
    const release = await seedScanRoute(page, id, ['ready'], true);
    await prepareScan(page, id);

    const processing = page.getByTestId('scan-processing-state');
    await expect(processing).toBeVisible();
    const stageStatus = processing.locator('[role="status"]');
    await expect(stageStatus).toHaveText('AI đang đọc nội dung.');
    await expect(processing.locator('[aria-live]')).toHaveCount(1);

    const elapsed = processing.getByText(/Đã chờ/);
    const beforeElapsed = await elapsed.textContent();
    const beforeAnnouncement = await stageStatus.textContent();
    await observeLiveChanges(page, '[data-testid="scan-processing-state"] [role="status"]');
    expect(await elapsed.evaluate((node) => Boolean(node.closest('[aria-live]')))).toBe(false);
    await page.waitForTimeout(1200);
    expect(await elapsed.textContent()).not.toBe(beforeElapsed);
    expect(await stageStatus.textContent()).toBe(beforeAnnouncement);
    await expect(stageStatus).toHaveAttribute('data-live-changes', '0');
    expect(await stageStatus.evaluate((node) => node.parentElement?.closest('[aria-live], [role="status"]'))).toBeNull();

    await strictAxe(page);
    release();
  });

  test('pending to ready has one meaningful lifecycle announcement and keeps focus stable', async ({ page }) => {
    const id = 't18d-scan-ready';
    const release = await seedScanRoute(page, id, ['ready'], true);
    await prepareScan(page, id);

    const lifecycle = page.getByTestId('scan-lifecycle-status');
    await expect(lifecycle).toHaveCount(1);
    await expect(lifecycle).toHaveText('');
    const back = page.getByRole('button', { name: 'Quay lại', exact: true });
    await back.focus();
    release();
    await expect(page.getByRole('button', { name: /Xác nhận .*nguyên liệu/ })).toBeVisible();
    await expect(lifecycle).toHaveText(/Kết quả quét đã sẵn sàng\. Có \d+ nguyên liệu cần kiểm tra\./);
    await expect(page.getByTestId('scan-lifecycle-status')).toHaveCount(1);
    await expect(page.locator('[data-testid="scan-lifecycle-status"] ~ [role="status"]')).toHaveCount(0);
    await expect(back).toBeFocused();
    await expect(page.getByRole('button', { name: /Xác nhận nguyên liệu/ })).toBeEnabled();
    const announcement = await lifecycle.textContent();
    await page.getByLabel('Tên nguyên liệu', { exact: true }).first().fill('Cà chua đã sửa');
    await expect(lifecycle).toHaveText(announcement!);
    await strictAxe(page);
  });

  test('pending to failed announces the failure once and leaves polling retry feedback separate', async ({ page }) => {
    const id = 't18d-scan-failed';
    const release = await seedScanRoute(page, id, ['failed'], true);
    await prepareScan(page, id);
    const back = page.getByRole('button', { name: 'Quay lại', exact: true });
    await back.focus();
    release();

    const lifecycle = page.getByTestId('scan-lifecycle-status');
    await expect(lifecycle).toHaveText('Bản quét không thể xử lý. Dịch vụ nhận diện phản hồi quá lâu. Hãy thử lại với ảnh nhỏ và rõ hơn.');
    await expect(lifecycle).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(back).toBeFocused();
    await expect(page.getByRole('button', { name: 'Quét ảnh mới', exact: true })).toBeEnabled();
    await strictAxe(page);
  });

  test('ready to confirmed conflict refetch announces the authoritative confirmed state without moving focus', async ({ page }) => {
    const id = 't18d-scan-confirmed';
    await seedScanRoute(page, id, ['ready', 'confirmed']);
    await page.route(`**/api/v1/scans/${id}/confirm`, async (route) => {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Đã thay đổi', code: 'CONFLICT' }) });
    });
    await prepareScan(page, id);

    const confirm = page.getByRole('button', { name: /Xác nhận .*nguyên liệu/ });
    await expect(confirm).toBeVisible();
    await confirm.focus();
    await confirm.click();
    await expect(page.getByTestId('scan-lifecycle-status')).toHaveText(/Đã xác nhận \d+ nguyên liệu\./);
    await expect(page.getByRole('button', { name: 'Xem tủ lạnh', exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/scan\/t18d-scan-confirmed\/review$/);
    await strictAxe(page);
  });

  test('normal scan confirmation still navigates to the fridge', async ({ page }) => {
    const id = 't18d-scan-success';
    await seedScanRoute(page, id, ['ready']);
    await page.route(`**/api/v1/scans/${id}/confirm`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, items: [] }) });
    });
    await prepareScan(page, id);
    await page.getByRole('button', { name: /Xác nhận .*nguyên liệu/ }).click();
    await expect(page).toHaveURL(/\/fridge$/);
  });

  test('a transient polling error remains separate from the eventual ready announcement', async ({ page }) => {
    const id = 't18d-poll-retry';
    const release = await seedScanRoute(page, id, ['ready'], true);
    await page.route(`**/api/v1/scans/${id}`, (route) => route.fulfill({
      status: 500, json: { error: 'Synthetic retryable read failure' },
    }), { times: 1 });
    await prepareScan(page, id);
    await expect(page.getByRole('alert')).toContainText('Không thể cập nhật trạng thái bản quét');
    await expect(page.getByTestId('scan-lifecycle-status')).toHaveText('');
    await page.getByRole('button', { name: 'Kiểm tra lại', exact: true }).click();
    release();
    await expect(page.getByTestId('scan-lifecycle-status')).toContainText('Kết quả quét đã sẵn sàng');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('T18D recipe tabs', () => {
  test.beforeEach(async ({ page }) => {
    await reset(page);
    await page.goto(`/recipes/${RECIPE_SLUG}`);
    await expect(page.getByRole('tablist', { name: 'Thông tin món ăn' })).toBeVisible();
  });

  test('uses a complete automatic-activation tab pattern and lets Tab leave the tablist', async ({ page }) => {
    const steps = page.getByRole('tab', { name: 'Cách nấu', exact: true });
    const ingredients = page.getByRole('tab', { name: 'Nguyên liệu', exact: true });
    const nutrition = page.getByRole('tab', { name: 'Dinh dưỡng', exact: true });

    await expectOnlySelectedRecipeTab(page, 'Cách nấu', 'recipe-detail-panel-steps');
    await expect(page.getByRole('tab')).toHaveCount(3);

    await steps.focus();
    await page.keyboard.press('ArrowRight');
    await expect(ingredients).toBeFocused();
    await expectOnlySelectedRecipeTab(page, 'Nguyên liệu', 'recipe-detail-panel-ingredients');
    await expect(page.getByRole('tabpanel')).toContainText('Nguyên liệu (');
    await page.keyboard.press('ArrowRight');
    await expect(nutrition).toBeFocused();
    await expectOnlySelectedRecipeTab(page, 'Dinh dưỡng', 'recipe-detail-panel-nutrition');
    await expect(page.getByRole('tabpanel')).toContainText('Dinh dưỡng mỗi khẩu phần');
    await page.keyboard.press('ArrowRight');
    await expect(steps).toBeFocused();
    await expectOnlySelectedRecipeTab(page, 'Cách nấu', 'recipe-detail-panel-steps');

    await page.keyboard.press('ArrowLeft');
    await expect(nutrition).toBeFocused();
    await page.keyboard.press('Home');
    await expect(steps).toBeFocused();
    await page.keyboard.press('End');
    await expect(nutrition).toBeFocused();
    await expectOnlySelectedRecipeTab(page, 'Dinh dưỡng', 'recipe-detail-panel-nutrition');

    await page.keyboard.press('Tab');
    await expect(page.locator('#recipe-detail-panel-nutrition')).toBeFocused();
    await steps.click();
    await expectOnlySelectedRecipeTab(page, 'Cách nấu', 'recipe-detail-panel-steps');
    await steps.press('Space');
    await expect(steps).toHaveAttribute('aria-selected', 'true');
    await strictAxe(page);
  });
});

test.describe('T18D cooking mode announcements and controls', () => {
  async function installSpeechRecognition(page: Page) {
    await page.addInitScript(() => {
      class MockSpeechRecognition {
        static latest: MockSpeechRecognition | null = null;
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        constructor() {
          MockSpeechRecognition.latest = this;
          (window as unknown as { __t18dRecognition?: MockSpeechRecognition }).__t18dRecognition = this;
        }
        start() {}
        stop() {}
      }
      (window as unknown as { SpeechRecognition: typeof MockSpeechRecognition }).SpeechRecognition = MockSpeechRecognition;
    });
  }

  async function readRecipe(page: Page) {
    return getJson<RecipeEnvelope>(page, `/api/v1/recipes/${RECIPE_SLUG}`);
  }

  test('announces step changes, exposes step progress, and retains focus on next/previous controls', async ({ page }) => {
    await reset(page);
    const recipe = await readRecipe(page);
    await page.goto(`/cook/${RECIPE_SLUG}`);

    const stepStatus = page.getByTestId('cooking-step-status');
    const progress = page.getByRole('progressbar');
    await expect(stepStatus).toContainText(`Bước 1 trên ${recipe.recipe.steps.length}.`);
    await expect(stepStatus).toContainText(recipe.recipe.steps[0].instruction);
    await expect(progress).toHaveAttribute('aria-valuemin', '1');
    await expect(progress).toHaveAttribute('aria-valuemax', String(recipe.recipe.steps.length));
    await expect(progress).toHaveAttribute('aria-valuenow', '1');
    await expect(progress).toHaveAttribute('aria-valuetext', `Bước 1 trên ${recipe.recipe.steps.length}`);

    const next = page.getByRole('button', { name: 'Bước tiếp theo', exact: true });
    const previous = page.getByRole('button', { name: 'Bước trước', exact: true });
    await next.focus();
    await next.click();
    await expect(next).toBeFocused();
    await expect(stepStatus).toContainText(`Bước 2 trên ${recipe.recipe.steps.length}.`);
    await expect(stepStatus).toContainText(recipe.recipe.steps[1].instruction);
    await expect(progress).toHaveAttribute('aria-valuenow', '2');

    await previous.focus();
    await previous.click();
    await expect(previous).toBeFocused();
    await expect(stepStatus).toContainText(`Bước 1 trên ${recipe.recipe.steps.length}.`);
    await expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(await stepStatus.evaluate((node) => Boolean(node.closest('[aria-live]')))).toBe(true);
    await strictAxe(page);
  });

  test('exit dialog enters, traps, dismisses with Escape and returns focus', async ({ page }) => {
    await reset(page);
    await page.goto(`/cook/${RECIPE_SLUG}`);
    const trigger = page.getByRole('button', { name: 'Thoát chế độ nấu', exact: true });
    await trigger.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Thoát chế độ nấu?' });
    const cancel = dialog.getByRole('button', { name: 'Hủy', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Thoát', exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('announces timer events without making the countdown itself a per-second live source', async ({ page }) => {
    test.setTimeout(120_000);
    await reset(page);
    const recipe = await readRecipe(page);
    const shortest = Math.min(...recipe.recipe.steps.map((step) => step.timerMinutes || Infinity));
    const timerIndex = recipe.recipe.steps.findIndex((step) => step.timerMinutes === shortest);
    expect(timerIndex, 'seeded recipe supplies the timer duration').toBeGreaterThanOrEqual(0);

    await page.goto(`/cook/${RECIPE_SLUG}`);
    for (let index = 0; index < timerIndex; index += 1) {
      await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
    }

    const start = page.getByRole('button', { name: /^Bật hẹn giờ/ });
    await expect(start).toBeVisible();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await expect(page.getByTestId('cooking-timer-status')).toHaveText('');
    await start.click();
    const timerStatus = page.getByTestId('cooking-timer-status');
    await expect(timerStatus).toHaveText('Đã bắt đầu hẹn giờ.');
    await expect(page.getByRole('button', { name: 'Tạm dừng hẹn giờ', exact: true })).toBeVisible();

    const countdown = page.getByText(/^\d{2}:\d{2}$/).first();
    expect(await countdown.evaluate((node) => Boolean(node.closest('[aria-live]')))).toBe(false);
    await observeLiveChanges(page, '[data-testid="cooking-timer-status"]');
    await observeLiveChanges(page, '[data-testid="cooking-step-status"]');
    const beforeCountdown = await countdown.textContent();
    await page.clock.runFor(1000);
    await expect(countdown).not.toHaveText(beforeCountdown!);
    await expect(timerStatus).toHaveText('Đã bắt đầu hẹn giờ.');
    await expect(timerStatus).toHaveAttribute('data-live-changes', '0');
    await expect(page.getByTestId('cooking-step-status')).toHaveAttribute('data-live-changes', '0');

    await page.getByRole('button', { name: 'Tạm dừng hẹn giờ', exact: true }).click();
    await expect(timerStatus).toHaveText('Đã tạm dừng hẹn giờ.');
    const paused = await countdown.textContent();
    await page.clock.runFor(3000);
    await expect(countdown).toHaveText(paused!);
    await page.getByRole('button', { name: 'Tiếp tục hẹn giờ', exact: true }).click();
    await expect(timerStatus).toHaveText('Đã tiếp tục hẹn giờ.');
    await page.getByRole('button', { name: 'Đặt lại hẹn giờ', exact: true }).click();
    await expect(timerStatus).toHaveText('Đã đặt lại hẹn giờ.');
    await observeLiveChanges(page, '[data-testid="cooking-timer-status"]');
    await page.getByRole('button', { name: 'Đặt lại hẹn giờ', exact: true }).click();
    await expect(timerStatus).not.toHaveAttribute('data-live-changes', '0');

    await page.getByRole('button', { name: 'Tạm dừng hẹn giờ', exact: true }).click();
    await page.getByRole('button', { name: 'Tiếp tục hẹn giờ', exact: true }).click();
    // Let React commit each scheduled tick; fastForward deliberately skips intervals.
    for (let remaining = shortest * 60 - 1; remaining >= 0; remaining -= 1) {
      await page.clock.runFor(1000);
      await expect(countdown).toHaveText(`${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`);
    }
    await expect(timerStatus).toHaveText('Hẹn giờ đã kết thúc.');
    await page.clock.resume();
    await strictAxe(page);
  });

  test('announces listening state and heard commands through the speech boundary only', async ({ page }) => {
    await reset(page);
    await installSpeechRecognition(page);
    await page.goto(`/cook/${RECIPE_SLUG}`);

    const listen = page.getByRole('button', { name: 'Bật trợ lý rảnh tay', exact: true });
    await listen.click();
    await expect(page.getByTestId('cooking-listening-status')).toHaveText('Trợ lý rảnh tay đã bật.');

    await page.evaluate(() => {
      const recognition = (window as unknown as { __t18dRecognition?: { onresult: (event: unknown) => void } }).__t18dRecognition;
      recognition?.onresult({ results: [[{ transcript: 'tiếp' }]] });
    });
    await expect(page.getByTestId('cooking-heard-status')).toHaveText('Đã nghe: tiếp');
    await expect(page.getByTestId('cooking-step-status')).toContainText('Bước 2 trên');

    await page.getByRole('button', { name: 'Tắt trợ lý rảnh tay', exact: true }).click();
    await expect(page.getByTestId('cooking-listening-status')).toHaveText('Trợ lý rảnh tay đã tắt.');
    await page.getByRole('button', { name: 'Bật trợ lý rảnh tay', exact: true }).click();
    await page.evaluate(() => {
      const recognition = (window as unknown as { __t18dRecognition: { onerror: (event: unknown) => void } }).__t18dRecognition;
      recognition.onerror({ error: 'not-allowed' });
    });
    await expect(page.getByTestId('cooking-listening-status')).toContainText('Trợ lý rảnh tay đã tắt. Không thể nghe khẩu lệnh');
    await expect(page.getByRole('button', { name: 'Bật trợ lý rảnh tay', exact: true })).toBeEnabled();
    await strictAxe(page);
  });

  test('gives each completion deduction control an ingredient-specific accessible name', async ({ page }) => {
    await reset(page);
    const recipe = await readRecipe(page);
    await page.goto(`/cook/${RECIPE_SLUG}`);

    for (let index = 1; index < recipe.recipe.steps.length; index += 1) {
      await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Hoàn thành nấu', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Món ăn hoàn tất/, level: 1 })).toBeFocused();

    const decrementButtons = page.getByRole('button', { name: /^Giảm lượng .+/ });
    const incrementButtons = page.getByRole('button', { name: /^Tăng lượng .+/ });
    await expect(decrementButtons).toHaveCount(await incrementButtons.count());
    expect(await decrementButtons.count()).toBeGreaterThan(0);
    for (const button of await decrementButtons.all()) {
      const label = await button.getAttribute('aria-label');
      expect(label).toMatch(/^Giảm lượng .+\S$/);
      const ingredient = label!.replace(/^Giảm lượng /, '');
      await expect(page.getByRole('button', { name: `Tăng lượng ${ingredient}`, exact: true })).toBeVisible();
    }
    await strictAxe(page);
  });
});

test('fridge and recipe filters expose their selected state after native keyboard activation', async ({ page }) => {
  await reset(page);
  await page.goto('/fridge');
  const all = page.getByRole('button', { name: /^Tất cả \(/ });
  const eggs = page.getByRole('button', { name: 'Trứng', exact: true }).and(page.locator('[aria-pressed]'));
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await eggs.press('Enter');
  await expect(eggs).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await page.goto('/recipes');
  const category = page.getByRole('button', { name: /Món Canh/ });
  await category.press('Space');
  await expect(category).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['Không mua thêm', '≤ 20 phút', 'Miền Bắc']) {
    const filter = page.getByRole('button', { name, exact: true });
    await filter.press('Enter');
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('button', { name: 'Toàn quốc', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await strictAxe(page);
});
