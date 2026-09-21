import { defineConfig } from '@playwright/test';
import baseline from './playwright.t17.config';

export default defineConfig({
  ...baseline,
  outputDir: '.hoplite/artifacts/t18c/results',
  reporter: [['list'], ['json', { outputFile: '.hoplite/artifacts/t18c/reports/browser.json' }]],
  use: { ...baseline.use, trace: 'off' },
  webServer: {
    ...baseline.webServer,
    // Reuse the managed, isolated Preview; never point this suite at staging.
    command: 'node scripts/security-preview.mjs',
    url: `http://127.0.0.1:${process.env.PORT ?? 3000}/__preview`,
    reuseExistingServer: true,
  },
});
