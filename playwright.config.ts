// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from '@playwright/test';
const port = process.env.PLAYWRIGHT_PORT ?? '4173';
const origin = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30000,
  // Baselines are Linux renders from the pinned Playwright image; keep the path free of the host platform.
  // Visual baselines are Linux renders from the pinned image; compare them in CI or via npm run test:visual.
  testIgnore: process.env.CI || process.env.VISUAL ? [] : ['**/visual.spec.ts'],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: origin,
    serviceWorkers: 'allow',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--no-sandbox'],
    },
  },
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command: `npm run dev --workspace @makersbrain/label-editor-pwa -- --host 127.0.0.1 --port ${port} --mode test`,
          url: origin,
          reuseExistingServer: false,
        },
      }),
});
