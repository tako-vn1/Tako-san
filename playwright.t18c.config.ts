import { defineConfig } from '@playwright/test';
import baseline from './playwright.t17.config';

const baseURL = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  ...baseline,
  outputDir: '.hoplite/artifacts/t18c/results',
  reporter: [['list'], ['json', { outputFile: '.hoplite/artifacts/t18c/reports/browser.json' }]],
  use: { ...baseline.use, baseURL, trace: 'off' },
  webServer: {
    ...baseline.webServer,
    // Reuse the managed, isolated Preview; never point this suite at staging.
    command: 'node scripts/security-preview.mjs',
    url: `${baseURL}/__preview`,
    env: { PORT: process.env.PORT ?? '3000', PREVIEW_APP_URL: baseURL, PREVIEW_API_PORT: process.env.PREVIEW_API_PORT ?? '8787' },
    reuseExistingServer: true,
  },
});
