import { mkdir, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, reset, control } from '../t13b/fixtures';
import { SCREEN_REGISTRY, type RegisteredScreen } from './screen-registry';
import { installNunito } from './font-fixture';

const root = '.hoplite/artifacts/t18c';

async function completeOnboarding(page: Page) {
  await page.goto('/onboarding/household');
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByRole('button', { name: /Bắt đầu với Takosan/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('T18C: all 27 identities have fresh screenshots, responsive and accessibility evidence', async ({ page }, info) => {
  test.setTimeout(420_000);
  const directory = `${root}/${info.project.name}`;
  await mkdir(directory, { recursive: true });
  await mkdir(`${root}/accessibility`, { recursive: true });
  await mkdir(`${root}/registry`, { recursive: true });
  const reports: Array<Record<string, unknown>> = [];
  const failures: string[] = [];

  async function capture(screen: RegisteredScreen, path = screen.path) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    if (screen.contract.heading) await expect(page.getByRole('heading', { name: screen.contract.heading }).first()).toBeVisible();
    if (screen.contract.text) await expect(page.getByText(screen.contract.text).first()).toBeVisible();
    if (screen.contract.testId) await expect(page.getByTestId(screen.contract.testId)).toBeVisible();
    if (screen.id === '09') await expect(page.getByRole('button', { name: /Xác nhận nguyên liệu/ })).toBeEnabled();
    await installNunito(page);
    await page.evaluate(() => document.fonts.ready);
    // Existing route entrances last up to 250 ms. Capture settled pixels.
    await page.waitForTimeout(350);
    const navigation = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(navigation).toHaveCount(screen.nav === 'visible' ? 1 : 0);
    if (screen.nav === 'visible') await expect(navigation).toBeVisible();
    const geometry = await page.evaluate(() => {
      const main = document.querySelector('main');
      const nav = [...document.querySelectorAll('nav[aria-label="Điều hướng chính"]')].find((element) => element.getBoundingClientRect().width > 0);
      const bounds = main?.getBoundingClientRect();
      const navBounds = nav?.getBoundingClientRect();
      const headings = Array.from(document.querySelectorAll('h1'));
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        h1Count: headings.length,
        main: bounds ? { x: bounds.x, width: bounds.width } : null,
        navigation: navBounds ? { x: navBounds.x, y: navBounds.y, width: navBounds.width, height: navBounds.height } : null,
        font: main ? getComputedStyle(main).fontFamily : null,
        imagesWithoutAlt: document.querySelectorAll('img:not([alt])').length,
        fontFaces: [...document.fonts].map(({ family, weight, status }) => ({ family, weight, status })),
      };
    });
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .exclude('iframe')
      .analyze();
    const violations = axe.violations.map(({ id, impact, help, nodes }) => ({
      id, impact, help, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    }));
    if (geometry.scrollWidth > geometry.width) failures.push(`${screen.id}: horizontal overflow ${geometry.scrollWidth}/${geometry.width}`);
    if (geometry.h1Count !== 1) failures.push(`${screen.id}: h1 count ${geometry.h1Count}`);
    if (geometry.imagesWithoutAlt) failures.push(`${screen.id}: images without alt`);
    for (const violation of violations) failures.push(`${screen.id}: axe ${violation.id} (${violation.impact})`);
    const screenshot = `${info.project.name}/${screen.id}-${screen.name}.png`;
    await page.screenshot({ path: `${root}/${screenshot}`, fullPage: true, animations: 'disabled' });
    reports.push({
      id: screen.id, name: screen.name, canonicalRoute: screen.path, fixtureRoute: path,
      auth: screen.auth, shell: screen.nav === 'hidden' ? 'immersive' : geometry.width < 768 ? 'bottom-navigation' : geometry.width < 1024 ? 'rail' : 'sidebar',
      viewport: page.viewportSize(), screenshot, geometry, violations,
      state: screen.id === '03' ? 'no-verification-context' : 'settled-seeded',
      directReference: 'UNAVAILABLE', visualParity: 'BLOCKED_REFERENCE_UNAVAILABLE',
      axeIncomplete: axe.incomplete.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
    });
    await writeFile(`${root}/registry/${info.project.name}.json`, JSON.stringify(reports, null, 2));
    await writeFile(`${root}/accessibility/${info.project.name}.json`, JSON.stringify(reports.map(({ id, name, violations, axeIncomplete }) => ({ id, name, violations, axeIncomplete })), null, 2));
  }

  await page.goto('/landing');
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  for (const screen of SCREEN_REGISTRY.filter((s) => s.auth === 'public')) await capture(screen);

  await reset(page);
  for (const screen of SCREEN_REGISTRY.filter((s) => ['04', '05', '06'].includes(s.id))) await capture(screen);
  await completeOnboarding(page);
  await control(page, 't13-scans');
  await page.goto('/planner/new');
  await page.getByRole('button', { name: 'Tạo thực đơn' }).click();
  await expect(page.getByTestId('plan-revision')).toBeVisible();
  const planPath = new URL(page.url()).pathname;
  const meal = page.locator('a[href*="/meal/"]').first();
  await expect(meal).toBeVisible();
  const mealPath = (await meal.getAttribute('href'))!;
  const dynamic: Record<string, string> = {
    '09': '/scan/t13b-preview-fridge/review',
    '11': '/fridge/preview-stock-egg',
    '13': '/recipes/canh-chua-ca-loc-nam-bo',
    '14': '/cook/canh-chua-ca-loc-nam-bo',
    '17': mealPath,
    '18': `${planPath}/shopping`,
  };
  for (const screen of SCREEN_REGISTRY.filter((s) => s.auth === 'session' && !['04', '05', '06'].includes(s.id))) {
    await capture(screen, dynamic[screen.id] ?? screen.path);
  }
  expect(reports).toHaveLength(27);
  expect(failures, 'all severities: no unexplained accessibility or responsive failures').toEqual([]);
});
