// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

/** Editor ground per theme, from the mb-ui semantic tokens that the standalone theme mirrors. */
const ground = { light: 'rgb(247, 243, 238)', dark: 'rgb(19, 15, 13)' };

/**
 * Three-state theming: the OS preference decides unless the document carries
 * an explicit data-theme, which wins in both directions.
 */
for (const colorScheme of ['light', 'dark'] as const) {
  for (const choice of ['none', 'light', 'dark'] as const) {
    const expected = choice === 'none' ? colorScheme : choice;
    test(`OS ${colorScheme} with data-theme ${choice} renders the ${expected} ground`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await page.evaluate((value) => {
        if (value === 'none') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = value;
      }, choice);
      await expect(page.locator('.mb-label-editor').first()).toHaveCSS('background-color', ground[expected]);
      await expect(page.locator('body')).toHaveCSS('background-color', ground[expected]);
    });
  }
}
