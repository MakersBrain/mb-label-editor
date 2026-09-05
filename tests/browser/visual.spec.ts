// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

/**
 * Visual baselines per side-panel tab in both themes at a laptop viewport.
 * Baselines are generated inside the pinned Playwright Docker image
 * (`npm run test:visual:update`) so CI, which runs the same image's
 * Chromium on Linux, compares like with like.
 */
test.use({ serviceWorkers: 'block', viewport: { width: 1366, height: 768 } });

for (const colorScheme of ['light', 'dark'] as const) {
  for (const tab of ['Layers', 'Assets', 'Data', 'Printer']) {
    test(`${tab} tab in ${colorScheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('/');
      // The footer names the loaded printer SDK; before that the label preview is still settling.
      await expect(page.locator('footer')).toContainText('sdk-', { timeout: 20000 });
      await page
        .getByRole('navigation', { name: 'Drawing tools' })
        .getByRole('button', { name: 'Text', exact: true })
        .click();
      await page.getByRole('tab', { name: tab }).click();
      if (tab === 'Data') {
        await page.getByRole('button', { name: 'Load sample CSV' }).click();
        await expect(page.getByText('3 records · 3 columns')).toBeVisible();
      }
      await expect(page.locator('.media')).toBeVisible();
      await expect(page.locator('.element.text')).toBeVisible();
      await page.waitForTimeout(400);
      await expect(page).toHaveScreenshot(`${tab.toLowerCase()}-${colorScheme}.png`, {
        mask: [page.locator('footer .build'), page.locator('.status')],
        animations: 'disabled',
      });
    });
  }
}
