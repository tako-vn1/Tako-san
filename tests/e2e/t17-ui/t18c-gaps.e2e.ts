import type { Locator, Page } from '@playwright/test';
import { test, expect, reset, control } from '../t13b/fixtures';

const SHELL_LABEL = 'Điều hướng chính';

async function settle(page: Page) {
  await page.evaluate(() =>
    document.fonts.ready.then(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 250))),
    ),
  );
}

async function clearPublicSession(page: Page) {
  await page.goto('/landing');
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function completeOnboarding(page: Page) {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByRole('button', { name: /Bắt đầu với Takosan/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = page.viewportSize()!.width;
  const geometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.innerWidth).toBe(width);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function expectActionClearOfShell(page: Page, action: Locator) {
  const nav = page.getByRole('navigation', { name: SHELL_LABEL });
  const [actionBox, navBox] = await Promise.all([action.boundingBox(), nav.boundingBox()]);
  expect(actionBox).not.toBeNull();
  expect(navBox).not.toBeNull();

  const width = page.viewportSize()!.width;
  if (width < 640) {
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
  } else {
    expect(actionBox!.x).toBeGreaterThanOrEqual(navBox!.x + navBox!.width - 1);
  }
}

test('RecipeCard links are titled, tabbable, and Enter navigates from Home and Recipes', async ({ page }, info) => {
  await reset(page);
  await completeOnboarding(page);

  for (const path of ['/', '/recipes']) {
    await page.goto(path);
    const card = page.locator('a[href^="/recipes/"]').first();
    await expect(card).toBeVisible();

    const title = (await card.locator('h2, h3').first().innerText()).trim();
    await expect(card).toHaveAccessibleName(new RegExp(escapeRegExp(title)));
    let reachedByTab = false;
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press('Tab');
      if (await card.evaluate((element) => element === document.activeElement)) {
        reachedByTab = true;
        break;
      }
    }
    expect(reachedByTab, 'recipe card root is reachable with Tab').toBe(true);
    await expect(card).toBeFocused();
    const href = await card.getAttribute('href');
    expect(href).toMatch(/^\/recipes\/[^/]+$/);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href!)}$`));
  }

  await page.screenshot({ path: info.outputPath('recipe-card-link.png'), fullPage: true });
});

test('recipe discovery is image-first and keeps multiple columns without changing the catalog', async ({ page }, info) => {
  await reset(page);
  await page.goto('/recipes');
  const grid = page.getByTestId('recipe-discovery-grid');
  const cards = grid.getByRole('link');
  await expect(cards.first()).toBeVisible();
  const [first, second, image, heading] = await Promise.all([
    cards.nth(0).boundingBox(), cards.nth(1).boundingBox(),
    cards.nth(0).getByRole('img').boundingBox(),
    cards.nth(0).getByRole('heading').boundingBox(),
  ]);
  expect(first && second && image && heading).toBeTruthy();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
  expect(second!.x).toBeGreaterThan(first!.x);
  expect(heading!.y).toBeGreaterThanOrEqual(image!.y + image!.height);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('recipe-discovery-grid.png'), fullPage: true });
});

test('privacy permission state reads as one inline sentence rather than separated flex fragments', async ({ page }, info) => {
  await reset(page);
  await page.goto('/settings/privacy');
  const permission = page.locator('p').filter({ hasText: 'Quyền thông báo hiện tại:' });
  await expect(permission).toContainText('Takosan không thể tự bật.');
  expect(await permission.locator('strong').evaluate((element) => getComputedStyle(element.parentElement!).display)).not.toBe('flex');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: info.outputPath('privacy-permission.png'), fullPage: true });
});

test('fresh onboarding household choices are native radios with their spoken names', async ({ page }, info) => {
  await reset(page);
  await page.goto('/onboarding/household');

  const labels = ['1 người', '2 người', '3 người', '4 người', '5 người trở lên'];
  const radios = page.getByRole('radio');
  await expect(radios).toHaveCount(labels.length);
  for (const label of labels) {
    const radio = page.getByRole('radio', { name: label, exact: true });
    await expect(radio).toBeVisible();
    await expect(radio).toHaveAccessibleName(label);
  }

  await page.screenshot({ path: info.outputPath('onboarding-household-radios.png'), fullPage: true });
});

test('Plus plan choices expose the Takosan Plus group without changing payment behavior', async ({ page }, info) => {
  await reset(page);
  await page.goto('/plus');

  const planGroup = page.getByRole('group', { name: 'Gói Takosan Plus', exact: true });
  await expect(planGroup).toBeVisible();
  expect(await planGroup.getByRole('button').count()).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('plus-plan-group.png'), fullPage: true });
});

test('AppShell honors the 640 breakpoint and exposes the active route', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-390', 'boundary widths run once from the mobile-390 project');
  await reset(page);
  await control(page, 't13-scans');

  const cases = [
    { width: 639, height: 844, navWidth: 639, mainX: 0, shell: 'bottom' },
    { width: 640, height: 844, navWidth: 80, mainX: 80, shell: 'rail' },
    { width: 767, height: 844, navWidth: 80, mainX: 80, shell: 'rail' },
    { width: 1024, height: 768, navWidth: 256, mainX: 256, shell: 'sidebar' },
  ] as const;

  for (const boundary of cases) {
    await page.setViewportSize({ width: boundary.width, height: boundary.height });
    await page.goto('/recipes');
    const nav = page.getByRole('navigation', { name: SHELL_LABEL });
    await expect(nav).toHaveCount(1);
    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    const mainBox = await page.locator('main').first().boundingBox();
    expect(navBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(navBox!.width).toBe(boundary.navWidth);
    expect(mainBox!.x).toBeGreaterThanOrEqual(boundary.mainX);
    await expectNoHorizontalOverflow(page);

    await expect(nav.getByRole('link', { name: 'Công thức' })).toHaveAttribute('aria-current', 'page');

    if (boundary.width === 640 || boundary.width === 767) {
      await page.goto('/fridge');
      const inventoryAction = page.getByRole('button', { name: 'Thêm nguyên liệu', exact: true });
      await expect(inventoryAction).toBeVisible();
      await expectActionClearOfShell(page, inventoryAction);

      await page.goto('/scan/t13b-preview-fridge/review');
      const scanAction = page.getByRole('button', { name: /Xác nhận nguyên liệu/ });
      await expect(scanAction).toBeVisible();
      await expect(scanAction).toBeEnabled();
      await expectActionClearOfShell(page, scanAction);
      await expectNoHorizontalOverflow(page);

      await page.goto('/recipes');
    }

    await page.screenshot({ path: info.outputPath(`app-shell-${boundary.shell}-${boundary.width}.png`), fullPage: true });
  }
  await clearPublicSession(page);
  for (const width of [640, 767]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/landing');
    await settle(page);
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
    const mascot = await page.getByRole('img', { name: 'Takosan cầm tủ lạnh' }).boundingBox();
    expect(heading && mascot).toBeTruthy();
    expect(heading!.x + heading!.width).toBeLessThanOrEqual(mascot!.x);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`landing-boundary-${width}.png`), fullPage: true });
  }
});

test('inventory and scan review fixed actions clear the active navigation shell', async ({ page }, info) => {
  await reset(page);

  await page.goto('/fridge');
  const inventoryAction = page.getByRole('button', { name: 'Thêm nguyên liệu', exact: true });
  await expect(inventoryAction).toBeVisible();
  await expectActionClearOfShell(page, inventoryAction);

  await control(page, 't13-scans');
  await page.goto('/scan/t13b-preview-fridge/review');
  const scanAction = page.getByRole('button', { name: /Xác nhận nguyên liệu/ });
  await expect(scanAction).toBeVisible();
  await expect(scanAction).toBeEnabled();
  await expectActionClearOfShell(page, scanAction);
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: info.outputPath('fixed-actions-clearance.png'), fullPage: true });
});

test('Landing hero keeps real heading, mascot, and CTA in a tablet/desktop split', async ({ page }, info) => {
  await clearPublicSession(page);
  await page.goto('/landing');
  await settle(page);

  const heading = page.getByRole('heading', { level: 1 });
  const mascot = page.locator('img[alt="Takosan cầm tủ lạnh"]');
  const cta = page.getByRole('button', { name: 'Dùng thử Takosan ngay', exact: true });
  await expect(heading).toBeVisible();
  await expect(mascot).toBeVisible();
  await expect(cta).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const width = page.viewportSize()!.width;
  if (width >= 640) {
    const [headingBox, mascotBox, ctaBox] = await Promise.all([
      heading.boundingBox(), mascot.boundingBox(), cta.boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(mascotBox).not.toBeNull();
    expect(ctaBox).not.toBeNull();
    expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(mascotBox!.x + 1);
    expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(mascotBox!.x + 1);
    expect(mascotBox!.x).toBeGreaterThan(headingBox!.x);
    await page.screenshot({ path: info.outputPath(`landing-split-${width}.png`), fullPage: true });
  }
});

test('Home primary and recommendation regions stay bounded and distinct on wide layouts', async ({ page }, info) => {
  await reset(page);
  await completeOnboarding(page);
  await page.goto('/');
  await settle(page);

  const primary = page.getByTestId('t18c-home-primary');
  const recommendations = page.getByTestId('t18c-home-recommendations');
  await expect(primary).toBeVisible();
  await expect(recommendations).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const [mainBox, primaryBox, recommendationsBox] = await Promise.all([
    page.locator('main').first().boundingBox(),
    primary.boundingBox(),
    recommendations.boundingBox(),
  ]);
  expect(mainBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  expect(recommendationsBox).not.toBeNull();
  expect(primaryBox!.x).toBeGreaterThanOrEqual(mainBox!.x);
  expect(primaryBox!.x + primaryBox!.width).toBeLessThanOrEqual(mainBox!.x + mainBox!.width + 1);
  expect(recommendationsBox!.x).toBeGreaterThanOrEqual(mainBox!.x);
  expect(recommendationsBox!.x + recommendationsBox!.width).toBeLessThanOrEqual(mainBox!.x + mainBox!.width + 1);

  if (page.viewportSize()!.width >= 768) {
    expect(primaryBox!.x + primaryBox!.width).toBeLessThanOrEqual(recommendationsBox!.x + 1);
  }
  if (page.viewportSize()!.width >= 1024) {
    expect(primaryBox!.width).toBeGreaterThan(recommendationsBox!.width);
    await page.screenshot({ path: info.outputPath(`home-regions-${page.viewportSize()!.width}.png`), fullPage: true });
  }
});

test('inventory detail and recipe recommendations are keyboard-navigable without merging row actions', async ({ page }, info) => {
  await reset(page);
  await page.goto('/fridge');

  const firstRow = page.getByTestId('inventory-row').first();
  await expect(firstRow).toBeVisible();
  const itemId = await firstRow.getAttribute('data-item-id');
  expect(itemId).toBeTruthy();
  const row = page.locator(`[data-testid="inventory-row"][data-item-id="${itemId}"]`);
  const heading = row.getByRole('heading').first();
  const ingredientName = (await heading.innerText()).trim();
  const ingredientButton = row.getByRole('button', { name: ingredientName, exact: true });
  await expect(ingredientButton).toBeVisible();
  await expect(heading).toContainText(ingredientName);

  const quantityButtons = row.getByRole('button', { name: /^(Tăng số lượng|Giảm số lượng)$/ });
  const deleteButton = row.getByRole('button', { name: 'Xóa nguyên liệu', exact: true });
  await expect(quantityButtons).toHaveCount(2);
  await expect(quantityButtons.first()).toBeVisible();
  await expect(deleteButton).toBeVisible();
  expect(await ingredientButton.locator('button').count()).toBe(0);

  const update = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' && response.url().endsWith(`/inventory/${itemId}`),
  );
  await row.getByRole('button', { name: 'Tăng số lượng', exact: true }).click();
  expect((await update).status()).toBe(200);
  await expect(page).toHaveURL(/\/fridge$/);
  await deleteButton.click();
  const confirmation = page.getByRole('alertdialog', { name: 'Xóa nguyên liệu?' });
  await expect(confirmation).toBeVisible();
  await expect(page).toHaveURL(/\/fridge$/);
  await confirmation.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await page.screenshot({ path: info.outputPath('inventory-keyboard-controls.png'), fullPage: true });

  let reachedByTab = false;
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    if (await ingredientButton.evaluate((element) => element === document.activeElement)) {
      reachedByTab = true;
      break;
    }
  }
  expect(reachedByTab, 'ingredient detail control is reachable with Tab').toBe(true);
  await expect(ingredientButton).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/(?:ingredients|fridge)/${escapeRegExp(itemId!)}$`));

  const recipeLink = page.locator('a[href^="/recipes/"]').first();
  await expect(recipeLink).toBeVisible();
  let recipeReachedByTab = false;
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press('Tab');
    if (await recipeLink.evaluate((element) => element === document.activeElement)) {
      recipeReachedByTab = true;
      break;
    }
  }
  expect(recipeReachedByTab, 'recipe recommendation is reachable with Tab').toBe(true);
  await expect(recipeLink).toBeFocused();
  const recipeHref = await recipeLink.getAttribute('href');
  expect(recipeHref).toMatch(/^\/recipes\/[^/]+$/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(recipeHref!)}$`));

  await page.screenshot({ path: info.outputPath('inventory-detail-recipe-keyboard.png'), fullPage: true });
});

test('shopping item checkbox toggles with Space through the existing API mutation', async ({ page }, info) => {
  await reset(page);

  const item = {
    id: 't18c-keyboard-shopping-item',
    name: 'Hành tím kiểm thử',
    quantity: 2,
    unit: 'piece',
    isChecked: false,
    sourceRecipeTitle: '',
  };
  let patchCount = 0;
  let serverChecked = item.isChecked;

  await page.route('**/api/v1/shopping-list', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ ...item, isChecked: serverChecked }] }),
    });
  });
  await page.route('**/api/v1/shopping-list/items/t18c-keyboard-shopping-item', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    patchCount += 1;
    const body = route.request().postDataJSON() as { isChecked?: boolean };
    expect(body).toEqual({ isChecked: true });
    serverChecked = body.isChecked === true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        item: { ...item, isChecked: serverChecked },
      }),
    });
  });

  await page.goto('/shopping');
  const checkbox = page.getByRole('checkbox', { name: `Đánh dấu đã mua: ${item.name}`, exact: true });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toHaveAttribute('aria-checked', 'false');

  const mutation = page.waitForResponse((response) =>
    response.request().method() === 'PATCH' &&
    response.url().endsWith(`/shopping-list/items/${item.id}`),
  );
  await checkbox.press('Space');
  const mutationResponse = await mutation;
  expect(mutationResponse.status()).toBe(200);
  const mutationBody = await mutationResponse.json();
  expect(mutationBody).toMatchObject({
    success: true,
    item: { id: item.id, name: item.name, isChecked: true },
  });
  const checkedItem = page.getByRole('checkbox', { name: `Bỏ đánh dấu đã mua: ${item.name}`, exact: true });
  await expect(checkedItem).toHaveAttribute('aria-checked', 'true');
  await expect(checkedItem).toBeVisible();
  expect(patchCount).toBe(1);

  await page.screenshot({ path: info.outputPath('shopping-keyboard-checkbox.png'), fullPage: true });
});

test('the shell brand is a native keyboard link back to Home', async ({ page }) => {
  await reset(page);
  await completeOnboarding(page);
  await page.goto('/fridge');
  const brand = page.getByRole('link', { name: 'Takosan', exact: true }).first();
  await expect(brand).toHaveAttribute('href', '/');
  await brand.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /Xin chào/ })).toBeVisible();
});
