// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('open, edit, save, and reload the installed shell offline', async ({ page, context }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.stack ?? error.message));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  const fixture = await readFile(new URL('../../packages/label-editor/tests/fixtures/sdk-v4-text.mb-label.json', import.meta.url));
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  await expect(page).toHaveTitle('MakersBrain Label Editor');
  const input = page.locator('input[type=file][accept*="mb-label"]');
  await expect(input, `browser errors: ${problems.join(' | ')}`).toBeAttached({ timeout: 5000 });
  await input.setInputFiles({ name: 'fixture.mb-label.json', mimeType: 'application/json', buffer: fixture });
  await expect(page.locator('footer')).toContainText('Opened SDK compatibility');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('.mb-label.json');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('footer')).toContainText('Online');
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle('MakersBrain Label Editor');
  await expect(page.locator('footer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toBeVisible();
});

test('touch gestures, rulers, local SVG import, and autosave recovery work',async({page})=>{await page.goto('/');await expect(page.locator('.ruler.horizontal')).toBeVisible();await expect(page.locator('.ruler.vertical')).toBeVisible();const viewport=page.getByRole('application',{name:'Label canvas'});await viewport.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',clientX:200,clientY:100});await viewport.dispatchEvent('pointermove',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await expect(page.locator('input.zoom')).toBeVisible();const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';await page.locator('input[type=file][accept*="image"]' ).setInputFiles({name:'local.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible();await page.waitForTimeout(1700);const autosaves=await page.evaluate(async()=>await new Promise<number>((resolve,reject)=>{const request=indexedDB.open('makersbrain-label-editor');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const count=request.result.transaction('autosaves').objectStore('autosaves').count();count.onsuccess=()=>resolve(count.result);count.onerror=()=>reject(count.error)}}));expect(autosaves).toBeGreaterThan(0);await page.reload();await expect(page.locator('footer')).toContainText('Recovered autosave');await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible()});
