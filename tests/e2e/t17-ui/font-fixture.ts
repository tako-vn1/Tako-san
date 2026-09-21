import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const fonts = [400, 500, 600, 700, 800].map((weight) => ({
  weight,
  data: readFileSync(`tests/e2e/t17-ui/fonts/nunito-${weight}.ttf`).toString('base64'),
}));

export async function installNunito(page: Page) {
  // The isolated Preview deliberately removes Google requests. Supply the same
  // public font locally; never relax its network isolation for screenshots.
  await page.evaluate(async (fonts) => {
    for (const { weight, data } of fonts) {
      const face = new FontFace('Nunito', `url(data:font/ttf;base64,${data})`, { weight: String(weight) });
      document.fonts.add(await face.load());
    }
    await document.fonts.ready;
  }, fonts);
}
