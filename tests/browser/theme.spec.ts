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

test('reduced motion removes the chrome transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const grip = page.getByRole('separator', { name: 'Resize side panel' });
  await expect(grip).toBeVisible();
  const seconds = () => grip.evaluate((element) => parseFloat(getComputedStyle(element, '::after').transitionDuration));
  expect(await seconds()).toBeLessThan(0.001);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await seconds()).toBeCloseTo(0.12, 3);
});

/** WCAG relative luminance of an sRGB colour string from getComputedStyle. */
const CONTRAST_WALK = `
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const parse = (color) => {
    const match = color.match(/rgba?\\(([^)]+)\\)/);
    if (!match) return undefined;
    const parts = match[1].split(/[\\s,\\/]+/).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const blend = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const paper = '.media, .paper, .font-row, .thumb, .preview, .font-sample, .bundled-font, canvas';
  const skip = '[disabled], [aria-disabled="true"], .element, input, select, textarea, option, [aria-hidden="true"]';
  const failures = [];
  let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text) continue;
    const element = node.parentElement;
    if (!element || element.closest(paper) || element.closest(skip)) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.right < 0) continue;
    if (rect.top > innerHeight || rect.left > innerWidth) continue;
    let opacity = 1;
    let background;
    for (let current = element; current; current = current.parentElement) {
      const cs = getComputedStyle(current);
      opacity *= Number(cs.opacity);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) {
        background = background ? blend(background, bg) : bg;
        if (background.a >= 1 || bg.a >= 1) break;
      }
    }
    if (opacity < 0.95) continue;
    if (!background) background = parse(getComputedStyle(document.body).backgroundColor);
    const color = parse(style.color);
    if (!color || !background) continue;
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const minimum = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    checked += 1;
    const value = ratio(color.a < 1 ? blend(color, background) : color, background);
    if (value < minimum)
      failures.push(
        (element.getAttribute('aria-label') || element.className || element.tagName).toString().slice(0, 40) +
          ' "' + text.slice(0, 30) + '" ' + style.color + ' on rgb(' + Math.round(background.r) + ',' +
          Math.round(background.g) + ',' + Math.round(background.b) + ') = ' + value.toFixed(2),
      );
  }
  return { checked, failures };
`;

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every visible text passes WCAG AA contrast in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Drawing tools' })
      .getByRole('button', { name: 'Text', exact: true })
      .click();
    const seen: string[] = [];
    for (const tab of ['Layers', 'Assets', 'Data', 'Printer']) {
      await page.getByRole('tab', { name: tab }).click();
      if (tab === 'Data') await page.getByRole('button', { name: 'Load sample CSV' }).click();
      const result = await page.evaluate(new Function(CONTRAST_WALK) as () => { checked: number; failures: string[] });
      expect(result.checked, `${tab} text nodes examined`).toBeGreaterThan(30);
      seen.push(...result.failures.map((item) => `${tab}: ${item}`));
    }
    expect(seen).toEqual([]);
  });
}
