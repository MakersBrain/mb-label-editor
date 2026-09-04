// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const viewports = [
  {
    name: 'phone 360x740 @3x touch',
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  },
  {
    name: 'tablet 768x1024 @2x touch',
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  },
  {
    name: 'laptop 1366x768',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  {
    name: 'desktop 1920x1080',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  {
    name: 'desktop 2560x1440 @2x',
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 2,
    hasTouch: false,
    isMobile: false,
  },
  {
    name: 'ultrawide 3440x1440',
    viewport: { width: 3440, height: 1440 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
];

const MIN_TOUCH_TARGET = 44;

/** Visible controls outside the label itself; overlays whose hit area is elsewhere are excluded by class. */
async function controlBoxes(page: Page) {
  return page.evaluate((min) => {
    const selector =
      'button, input, select, textarea, summary, [role="tab"], [role="button"], [role="slider"], [role="separator"]';
    const skip = (element: Element) =>
      element.closest('.element, .handle, .selection-box') !== null ||
      element.matches(
        '.star, .scrim, [tabindex="-1"], input[type="checkbox"], input[type="radio"], [aria-hidden="true"]',
      );
    const small: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (skip(element)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (rect.width < min - 0.5 || rect.height < min - 0.5)
        small.push(
          `${element.tagName.toLowerCase()}${element.className ? '.' + String(element.className).split(' ')[0] : ''} "${(
            element.getAttribute('aria-label') ??
            element.textContent ??
            ''
          )
            .trim()
            .slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
    }
    return small;
  }, MIN_TOUCH_TARGET);
}

async function expectNoDocumentScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow.x, 'no horizontal document scroll').toBeLessThanOrEqual(0);
  expect(overflow.y, 'no vertical document scroll').toBeLessThanOrEqual(0);
}

for (const device of viewports) {
  test.describe(device.name, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      hasTouch: device.hasTouch,
      isMobile: device.isMobile,
    });

    test('the shell fits the window and the label is in view', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.media')).toBeVisible();
      await expectNoDocumentScroll(page);
      const canvas = (await page.locator('.canvas-area').boundingBox())!;
      if (device.viewport.width < 640) expect(canvas.width).toBeGreaterThanOrEqual(device.viewport.width - 2);
      else expect(canvas.width).toBeGreaterThanOrEqual(320);
      const media = (await page.locator('.media').boundingBox())!;
      expect(media.x).toBeGreaterThanOrEqual(0);
      expect(media.y).toBeGreaterThanOrEqual(0);
      expect(media.x + media.width).toBeLessThanOrEqual(device.viewport.width);
      expect(media.y + media.height).toBeLessThanOrEqual(device.viewport.height);
      // Every layout keeps the tool rail, the zoom control and the side panels reachable.
      await expect(page.getByRole('navigation', { name: 'Drawing tools' })).toBeVisible();
      await expect(page.locator('input.zoom')).toBeVisible();
      if (device.viewport.width <= 768) {
        await expect(page.locator('#side-panels')).toBeHidden();
        await page.getByRole('button', { name: 'Panels' }).click();
        await expect(page.locator('#side-panels')).toBeVisible();
        await expectNoDocumentScroll(page);
        // The scrim is clicked where the sheet or drawer does not cover it.
        await page.getByRole('button', { name: 'Close side panels' }).click({ position: { x: 8, y: 8 } });
        await expect(page.locator('#side-panels')).toBeHidden();
      } else {
        await expect(page.locator('#side-panels')).toBeVisible();
      }
      if (device.viewport.width >= 1440) await expect(page.getByLabel('Layers and properties')).toBeVisible();
    });

    if (device.hasTouch) {
      test('every visible control is at least 44px on touch screens', async ({ page }) => {
        await page.goto('/');
        await page
          .getByRole('navigation', { name: 'Drawing tools' })
          .getByRole('button', { name: 'Text', exact: true })
          .click();
        expect(await controlBoxes(page), 'shell controls').toEqual([]);
        await page.getByRole('button', { name: 'Panels' }).click();
        for (const tab of ['Layers', 'Assets', 'Data', 'Printer']) {
          await page.getByRole('tab', { name: tab }).click();
          expect(await controlBoxes(page), `${tab} tab`).toEqual([]);
        }
      });
    }
  });
}
