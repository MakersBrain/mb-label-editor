// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/**
 * Performance budget for one pointer drag on a label with an embedded image
 * and 40 extra text elements. The numbers only go down; each remediation
 * commit tightens the entry it fixes (see docs/editor-remediation-plan.md).
 */
const budget = {
  longTaskMs: 250,
  idbWriteTransactions: 400,
  sdkRenders: 150,
  sdkMeasures: 150,
};

declare global {
  interface Window {
    __mbIdb: { mode: string; stores: string[] }[];
    __mbLongTasks: number[];
  }
}

test.describe.configure({ retries: 1 });

test('a drag stays within the interaction budget', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    window.__mbIdb = [];
    window.__mbLongTasks = [];
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, stores, mode, options) {
      window.__mbIdb.push({ mode: mode ?? 'readonly', stores: Array.isArray(stores) ? [...stores] : [String(stores)] });
      return transaction.call(this, stores, mode, options);
    } as typeof transaction;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__mbLongTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });

  const fixture = await readFile(new URL('../fixtures/product-label-v4.mb-label.json', import.meta.url));
  await page.goto('/');
  await expect(page.locator('footer')).toContainText(/sdk-[0-9]/, { timeout: 20000 });
  const input = page.locator('input[type=file][accept*="mb-label"]');
  await input.setInputFiles({ name: 'fixture.mb-label.json', mimeType: 'application/json', buffer: fixture });
  await expect(page.locator('footer')).toContainText('Opened');

  const insertText = page.getByRole('button', { name: 'Text', exact: true }).first();
  const insertStart = Date.now();
  for (let i = 0; i < 40; i++) await insertText.click();
  const insertMs = Date.now() - insertStart;
  await expect(page.locator('.element')).toHaveCount(46);

  await page.evaluate(() => {
    window.__mbPerf?.reset();
    window.__mbIdb.length = 0;
    window.__mbLongTasks.length = 0;
  });

  const target = page.locator('.element').last();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 100 });
  await page.mouse.up();
  await page.waitForTimeout(2500);

  const measured = await page.evaluate(() => ({
    longestTaskMs: Math.max(0, ...window.__mbLongTasks),
    idbWriteTransactions: window.__mbIdb.filter((item) => item.mode === 'readwrite').length,
    sdkRenders: window.__mbPerf?.render ?? 0,
    sdkMeasures: window.__mbPerf?.measure ?? 0,
  }));
  test.info().annotations.push({ type: 'perf', description: JSON.stringify({ insertMs, ...measured }) });
  console.log('perf', JSON.stringify({ insertMs, ...measured }));

  expect(measured.longestTaskMs, 'longest task during the drag').toBeLessThanOrEqual(budget.longTaskMs);
  expect(measured.idbWriteTransactions, 'IndexedDB write transactions during the drag').toBeLessThanOrEqual(budget.idbWriteTransactions);
  expect(measured.sdkRenders, 'SDK renders during the drag').toBeLessThanOrEqual(budget.sdkRenders);
  expect(measured.sdkMeasures, 'SDK measures during the drag').toBeLessThanOrEqual(budget.sdkMeasures);
});
