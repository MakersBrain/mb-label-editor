// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Opens a menu-bar dialog, e.g. Label > Assets…. */
async function openDialog(page: Page, menu: string, item: string) {
  await page.getByLabel('Editor menus').getByText(menu, { exact: true }).click();
  await page.getByRole('button', { name: item }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

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
  await page.getByText('File', { exact: true }).click();
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

test('exports the current label as canonical JSON from the File menu', async ({ page }) => {
  await page.goto('/');
  const download = page.waitForEvent('download');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe('Untitled label.mb-label.json');
  const path = await exported.path();
  expect(path).not.toBeNull();
  const json = JSON.parse(await readFile(path!, 'utf8')) as { version: number; media: { unit: string } };
  expect(json).toMatchObject({ version: 4, media: { unit: 'micrometre' } });
  await expect(page.locator('footer')).toContainText('Exported JSON.');
});

test('fit-content continuous labels preview and export a finite resolved cut length',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  await openDialog(page,'Label','Media & zones…');
  const dialog=page.getByRole('dialog',{name:'Media & zones'});
  await dialog.getByLabel('Shape').selectOption('continuous');
  await expect(dialog.getByLabel('Length mode')).toBeEnabled();
  await dialog.getByLabel('Length mode').selectOption('fit-content');
  await expect(dialog.getByText('Calculated length (mm)')).not.toContainText('Calculating…',{timeout:10000});
  await dialog.getByRole('button',{name:'Close Media & zones'}).click();
  await expect(page.locator('.media.continuous .cut-line')).toBeVisible();
  const initialCut=Number((await page.locator('.cut-line').textContent())?.match(/[\d.]+/)?.[0]);
  await page.getByLabel('Y (mm)').fill('40');
  await page.getByLabel('Y (mm)').press('Tab');
  await expect.poll(async()=>Number((await page.locator('.cut-line').textContent())?.match(/[\d.]+/)?.[0])).toBeGreaterThan(initialCut+30);
  const download=page.waitForEvent('download');
  await page.getByText('File',{exact:true}).click();
  await page.getByRole('button',{name:'Export JSON',exact:true}).click();
  const path=await(await download).path();
  const canonical=JSON.parse(await readFile(path!,'utf8')) as {media:{height:number;continuous:boolean};elements:Array<{transform:{y:number}}>;extensions:Record<string,{continuousSettings?:{lengthMode?:string}}>};
  expect(canonical.media.continuous).toBe(true);
  expect(canonical.media.height).toBeGreaterThan(0);
  expect(canonical.elements[0].transform.y).toBe(40_000);
  expect(canonical.extensions['makersbrain.editor:state'].continuousSettings?.lengthMode).toBe('fit-content');
  await openDialog(page,'Label','Media & zones…');
  await page.getByRole('dialog',{name:'Media & zones'}).getByLabel('Shape').selectOption('rectangle');
  await page.getByRole('button',{name:'Close Media & zones'}).click();
  await page.getByText('File',{exact:true}).click();
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.locator('.media.continuous .cut-line')).toBeVisible();
  await page.getByRole('listitem').getByRole('button',{name:'Rectangle',exact:true}).click();
  await expect(page.getByLabel('Y (mm)')).toHaveValue('40');
  await openDialog(page,'Label','Media & zones…');
  const reopened=page.getByRole('dialog',{name:'Media & zones'});
  await expect(reopened.getByLabel('Length mode')).toHaveValue('fit-content');
  await reopened.getByLabel('Length mode').selectOption('fixed');
  await reopened.getByLabel('Cut length (mm)').fill('20');
  await reopened.getByLabel('Cut length (mm)').press('Tab');
  await expect(reopened.getByRole('status')).toContainText('extends past the fixed cut line');
  await reopened.getByRole('button',{name:'Close Media & zones'}).click();
});

test('continuous PNG and PDF exports use the resolved physical dimensions',async({page})=>{
  await page.goto('/');
  await openDialog(page,'Label','Media & zones…');
  const dialog=page.getByRole('dialog',{name:'Media & zones'});
  await dialog.getByLabel('Shape').selectOption('continuous');
  await dialog.getByLabel('Cut length (mm)').fill('30');
  await dialog.getByLabel('Cut length (mm)').press('Tab');
  await dialog.getByRole('button',{name:'Close Media & zones'}).click();
  const pngDownload=page.waitForEvent('download');
  await page.getByText('File',{exact:true}).click();
  await page.getByRole('button',{name:'Export PNG',exact:true}).click();
  const pngPath=await(await pngDownload).path();
  const png=await readFile(pngPath!);
  expect(png.readUInt32BE(16)).toBe(400);
  expect(png.readUInt32BE(20)).toBe(240);
  const pdfDownload=page.waitForEvent('download');
  await page.getByText('File',{exact:true}).click();
  await page.getByRole('button',{name:'Export PDF',exact:true}).click();
  const pdfPath=await(await pdfDownload).path();
  const box=(await readFile(pdfPath!,'latin1')).match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  expect(box).not.toBeNull();
  expect(Number(box![1])).toBeCloseTo(50*72/25.4,2);
  expect(Number(box![2])).toBeCloseTo(30*72/25.4,2);
});

test('invalid continuous settings disable output until printer limits make them valid',async({page})=>{
  await page.goto('/');
  await openDialog(page,'Label','Media & zones…');
  const dialog=page.getByRole('dialog',{name:'Media & zones'});
  await dialog.getByLabel('Shape').selectOption('continuous');
  await dialog.getByLabel('Cut length (mm)').fill('2000');
  await dialog.getByLabel('Cut length (mm)').press('Tab');
  await dialog.getByRole('button',{name:'Close Media & zones'}).click();
  await page.getByText('File',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Export JSON',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Export PNG',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Export PDF',exact:true})).toBeDisabled();
  await page.getByText('File',{exact:true}).click();
  await page.getByLabel('Printer model').selectOption('ql-1110nwb');
  await page.getByText('File',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Export JSON',exact:true})).toBeEnabled();
});

test('an unqualified printer cannot send a continuous label',async({page})=>{
  await page.goto('/');
  await openDialog(page,'Label','Media & zones…');
  const media=page.getByRole('dialog',{name:'Media & zones'});
  await media.getByLabel('Shape').selectOption('continuous');
  await media.getByRole('button',{name:'Close Media & zones'}).click();
  await page.getByLabel('Printer model').selectOption('m200');
  await expect(page.getByRole('button',{name:'Print label'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Print label'})).toHaveAttribute('title','The selected printer is not qualified for continuous media.');
});

test('continuous CSV records resolve to variable lengths and gate batch cutting',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Text',exact:true}).click();
  await page.getByRole('textbox',{name:'Text',exact:true}).fill('{{name}}');
  await page.getByLabel('Overflow').selectOption('auto-height');
  await page.getByLabel('Width').fill('20');
  await page.getByLabel('Width').press('Tab');
  await page.getByLabel('Printer model').selectOption('ql-1110nwb');
  await openDialog(page,'Label','Media & zones…');
  const media=page.getByRole('dialog',{name:'Media & zones'});
  await media.getByLabel('Shape').selectOption('continuous');
  await media.getByLabel('Length mode').selectOption('fit-content');
  await media.getByRole('button',{name:'Close Media & zones'}).click();
  await openDialog(page,'Label','Data…');
  const data=page.getByRole('dialog',{name:'Data'});
  await data.locator('input[type=file]').setInputFiles({name:'records.csv',mimeType:'text/csv',buffer:Buffer.from(`name\nShort\n${'A very long shipping description '.repeat(4)}\n`)});
  await expect(data.getByText('2 records · name')).toBeVisible();
  await data.getByRole('button',{name:'Close Data'}).click();
  await openDialog(page,'Print','Batch printing…');
  const batch=page.getByRole('dialog',{name:'Batch printing'});
  const cutting=batch.getByLabel('Batch cutting');
  await expect(cutting).toBeVisible();
  expect(await cutting.locator('option').allTextContents()).toEqual(['After each label','Do not cut']);
  await batch.getByRole('button',{name:'Calculate roll lengths'}).click();
  await expect(batch.getByText('Calculated 2 batch label length(s).')).toBeVisible({timeout:10_000});
  const lengths=await batch.locator('tbody tr td:nth-child(2)').allTextContents();
  expect(lengths).toHaveLength(2);
  expect(Number.parseFloat(lengths[1])).toBeGreaterThan(Number.parseFloat(lengths[0]));
});

test('selected elements follow the pointer before their move is committed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const element = page.locator('.element.selected');
  const before = await element.boundingBox();
  expect(before).not.toBeNull();
  const initialX = Number(await page.getByLabel('X (mm)').inputValue());
  const initialY = Number(await page.getByLabel('Y (mm)').inputValue());
  const center = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
  await page.keyboard.down('Alt');
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 38, center.y + 19, { steps: 3 });
  const during = await element.boundingBox();
  expect(during).not.toBeNull();
  expect(during!.x).toBeCloseTo(before!.x + 38, 0);
  expect(during!.y).toBeCloseTo(before!.y + 19, 0);
  expect(Number(await page.getByLabel('X (mm)').inputValue())).toBe(initialX);
  expect(Number(await page.getByLabel('Y (mm)').inputValue())).toBe(initialY);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(Number(await page.getByLabel('X (mm)').inputValue())).toBeGreaterThan(initialX);
  expect(Number(await page.getByLabel('Y (mm)').inputValue())).toBeGreaterThan(initialY);
});

test('resizing shows the new size live before the pointer is released', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const element = page.locator('.element.selected');
  const before = await element.boundingBox();
  expect(before).not.toBeNull();
  const initialWidth = await page.getByLabel('Width').inputValue();
  const handle = page.locator('.selection-box .handle.resize.se');
  const grip = await handle.boundingBox();
  expect(grip).not.toBeNull();
  const start = { x: grip!.x + grip!.width / 2, y: grip!.y + grip!.height / 2 };
  await page.keyboard.down('Alt');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 24, { steps: 4 });
  const during = await element.boundingBox();
  expect(during!.width).toBeCloseTo(before!.width + 40, 0);
  expect(during!.height).toBeCloseTo(before!.height + 24, 0);
  const box = await page.locator('.selection-box').boundingBox();
  expect(box!.width).toBeCloseTo(before!.width + 40, 0);
  expect(await page.getByLabel('Width').inputValue()).toBe(initialWidth);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(Number(await page.getByLabel('Width').inputValue())).toBeGreaterThan(Number(initialWidth));
  const after = await element.boundingBox();
  expect(after!.width).toBeCloseTo(before!.width + 40, 0);
});

test('undo and redo shortcuts work and the shortcut viewer lists them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await expect(page.locator('.element.rectangle')).toHaveCount(1);
  await page.locator('.viewport').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('.element.rectangle')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.element.rectangle')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.element.rectangle')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Undo/ }).first()).toHaveAttribute('title', /Undo \((Ctrl|Cmd)\+Z\)/);
  await page.keyboard.press('Shift+?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Undo', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Toggle keeping the aspect ratio')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Help' }).or(page.locator('summary', { hasText: 'Help' })).first().click();
  await page.getByRole('button', { name: 'Keyboard shortcuts…' }).click();
  await expect(dialog).toBeVisible();
});

test('layers can hold an empty group, nest elements by drag and drop, and fold', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await page.getByRole('button', { name: '+ Group' }).click();
  const layers = page.locator('aside ol > li');
  await expect(layers).toHaveCount(3);
  const groupRow = layers.filter({ hasText: 'Group' });
  const rectangleRow = layers.filter({ hasText: 'Rectangle' });
  await expect(groupRow.locator('.count')).toHaveText('0');
  await rectangleRow.dragTo(groupRow);
  await expect(groupRow.locator('.count')).toHaveText('1');
  await expect(layers).toHaveCount(3);
  const nested = layers.filter({ hasText: 'Rectangle' });
  expect(await nested.evaluate(node => parseFloat(getComputedStyle(node).paddingLeft))).toBeGreaterThan(8);
  expect(await groupRow.evaluate(node => parseFloat(getComputedStyle(node).paddingLeft))).toBe(0);
  await groupRow.getByRole('button', { name: 'Collapse Group' }).click();
  await expect(layers).toHaveCount(2);
  await groupRow.getByRole('button', { name: 'Expand Group' }).click();
  await expect(layers).toHaveCount(3);
  await nested.dragTo(layers.filter({ hasText: 'Ellipse' }));
  await expect(groupRow.locator('.count')).toHaveText('0');
  expect(await layers.filter({ hasText: 'Rectangle' }).evaluate(node => parseFloat(getComputedStyle(node).paddingLeft))).toBe(0);
});

test('selection resize and label alignment controls are available on the canvas', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await expect(page.locator('.selection-box .resize')).toHaveCount(8);
  await page.getByLabel('Height').fill('6');
  await page.getByLabel('Height').press('Tab');
  let handle = await page.locator('.selection-box .resize.se').boundingBox();
  expect(handle).not.toBeNull();
  await page.keyboard.down('Shift');
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 38, handle!.y + handle!.height / 2);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const proportionalWidth = Number(await page.getByLabel('Width').inputValue());
  const proportionalHeight = Number(await page.getByLabel('Height').inputValue());
  expect(proportionalWidth / proportionalHeight).toBeCloseTo(2, 4);
  handle = await page.locator('.selection-box .resize.se').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 19, handle!.y + handle!.height / 2);
  await page.mouse.up();
  expect(Number(await page.getByLabel('Height').inputValue())).toBeCloseTo(proportionalHeight, 4);
  const anchoredRight = Number(await page.getByLabel('X (mm)').inputValue()) + Number(await page.getByLabel('Width').inputValue());
  const anchoredBottom = Number(await page.getByLabel('Y (mm)').inputValue()) + Number(await page.getByLabel('Height').inputValue());
  handle = await page.locator('.selection-box .resize.nw').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 12, handle!.y + handle!.height / 2 + 8);
  await page.mouse.up();
  expect(Number(await page.getByLabel('X (mm)').inputValue()) + Number(await page.getByLabel('Width').inputValue())).toBeCloseTo(anchoredRight, 4);
  expect(Number(await page.getByLabel('Y (mm)').inputValue()) + Number(await page.getByLabel('Height').inputValue())).toBeCloseTo(anchoredBottom, 4);
  await page.getByRole('button', { name: 'Align right', exact: true }).click();
  expect(Number(await page.getByLabel('X (mm)').inputValue())).toBeCloseTo(50 - Number(await page.getByLabel('Width').inputValue()), 4);
});

test('grouping selects the new group for immediate alignment', async ({ page }) => {
  await page.goto('/');
  const tools = page.getByRole('navigation', { name: 'Drawing tools' });
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.locator('aside section').first().locator('button.name').last().click({ modifiers: ['Shift'] });
  await tools.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(page.getByText('2 child elements', { exact: true })).toBeVisible();
  await expect(page.locator('li.selected')).toContainText('Group');
  await page.getByRole('button', { name: 'Align right', exact: true }).click();
  const width = Number(await page.getByLabel('Width').inputValue());
  expect(Number(await page.getByLabel('X (mm)').inputValue())).toBeCloseTo(50 - width, 4);
});

test('assigned elements align and snap in zone root coordinates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await openDialog(page, 'Label', 'Media & zones…');
  const media = page.getByRole('dialog', { name: 'Media & zones' });
  await media.getByRole('button', { name: 'Add independent zone' }).click();
  const zone = media.getByRole('group', { name: 'Zone 1' });
  for (const [name, value] of [['x', '20'], ['y', '5'], ['width', '20'], ['height', '15']] as const) {
    await zone.getByLabel(name, { exact: true }).fill(value);
    await zone.getByLabel(name, { exact: true }).press('Tab');
  }
  await media.getByRole('button', { name: 'Close Media & zones' }).click();
  const assigned = page.getByLabel('Assigned zone');
  await assigned.selectOption({ label: 'Zone 1' });
  expect(await assigned.inputValue()).not.toBe('');
  const download = page.waitForEvent('download');
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8')) as { elements: Array<{ constraints?: { zone?: string } }> };
  expect(saved.elements[0].constraints?.zone).toBe(await assigned.inputValue());
  await page.locator('.align-tools select').selectOption({ label: 'Zone 1' });
  await page.getByRole('button', { name: 'Align right', exact: true }).click();

  const width = Number(await page.getByLabel('Width').inputValue());
  expect(Number(await page.getByLabel('X (mm)').inputValue())).toBeCloseTo(20 - width, 4);
  const left = Number.parseFloat(await page.locator('.element.rectangle').evaluate(element => (element as HTMLElement).style.left));
  expect(left).toBeCloseTo((40 - width) * 3.7795275591, 3);
});

test('MB UI branding and semantic light/dark themes apply without inversion', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[title="MakersBrain Label Editor"]')).toBeVisible();
  const colors = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.mb-label-editor');
    if (!editor) throw new Error('editor theme root is missing');
    document.documentElement.dataset.theme = 'light';
    const light = getComputedStyle(editor).backgroundColor;
    document.documentElement.dataset.theme = 'dark';
    const dark = getComputedStyle(editor).backgroundColor;
    return {
      light,
      dark,
      filter: getComputedStyle(document.documentElement).filter,
      shadcnPrimary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      mbAccent: getComputedStyle(document.documentElement).getPropertyValue('--mb-accent').trim()
    };
  });
  expect(colors.light).not.toBe(colors.dark);
  expect(colors.filter).toBe('none');
  expect(colors.shadcnPrimary).toBe(colors.mbAccent);
});

test.describe('local printer persistence', () => {
test.use({ serviceWorkers: 'block' });
test('a saved IPP connection waits for an explicit refresh before probing localhost', async ({ page }) => {
  const connection = { id: 'brother-network', model: 'ql-1110nwb', status: 'idle', transport: { kind: 'ipp', uri: 'ipp://10.83.30.114:631/ipp/print' }, media: { widthMm: 29, lengthMm: 62, keyword: 'om_brother-label-29x62mm_29x62mm' } };
  let applicationRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem('mb-local-api-token', 'test-token');
    localStorage.setItem('mb-local-api-connection', 'brother-network');
  });
  await page.route('http://127.0.0.1:9847/v1/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers()['origin'] ?? 'http://127.0.0.1:4173', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,idempotency-key', 'access-control-allow-private-network': 'true', 'content-type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    applicationRequests++;
    const selected = new URL(route.request().url()).searchParams.has('connection');
    return route.fulfill({ status: 200, headers, body: JSON.stringify(selected ? { connection, connected: true, status: 'idle', media: connection.media } : { connections: [connection], connected: false, status: 'not-connected', media: null }) });
  });
  await page.goto('/');
  await expect(page.getByLabel('Printer model')).toBeVisible();
  expect(applicationRequests).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('mb-local-api-connection'))).toBe('brother-network');
  await openDialog(page, 'Print', 'Local service…');
  expect(applicationRequests).toBe(0);
  await page.getByRole('dialog', { name: 'Local service' }).getByRole('button', { name: 'Refresh' }).click();
  // The explicit refresh negotiates features before listing connections.
  await expect.poll(() => applicationRequests).toBe(2);
  await page.getByRole('button', { name: 'Close Local service' }).click();
  const selector = page.getByLabel('Connection');
  await expect(selector).toHaveValue('local');
  await expect(selector.locator('option:checked')).toHaveText('IPP · brother-network');
  await expect(page.getByLabel('Printer model')).toHaveValue('ql-1110nwb');
  await expect(page.getByText(/Saved by the local service as brother-network/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Printer model')).toBeVisible();
  expect(applicationRequests).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('mb-local-api-connection'))).toBe('brother-network');
});
});

test.describe('local printer discovery and diagnostics', () => {
test.use({ serviceWorkers: 'block' });
test('runs discovery and capability-gated Brother diagnostics only after explicit actions', async ({ page }) => {
  const brother = { id: 'brother-network', model: 'ql-1110nwb', status: 'idle', transport: { kind: 'ipp', uri: 'ipp://brother.local:631/ipp/print' }, operations: ['status', 'wifi-status', 'wifi-scan', 'system-report'] };
  const generic = { id: 'generic-network', model: 'pm241', status: 'ready', transport: { kind: 'tcp', address: 'printer.local:9100' }, operations: ['status'] };
  const calls: string[] = [];
  let wifiStatusAttempts = 0;
  await page.addInitScript(() => {
    localStorage.setItem('mb-local-api-token', 'paired-token');
    localStorage.setItem('mb-local-api-connection', 'brother-network');
  });
  await page.route('http://127.0.0.1:9847/v1/**', async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': request.headers()['origin'] ?? 'http://127.0.0.1:4173', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,idempotency-key', 'access-control-allow-private-network': 'true', 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    calls.push(`${request.method()} ${request.url()}`);
    if (request.url().endsWith('/discovery')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ devices: [{ transport: 'usb', address: 'usb:04f9:209b', name: 'Brother QL-1110NWB', matchedModel: 'ql-1110nwb', operations: brother.operations }], supportedTransports: ['usb', 'ipp'] }) });
    if (request.url().endsWith('/brother/wifi/status')) {
      wifiStatusAttempts++;
      if (wifiStatusAttempts === 1) return route.fulfill({ status: 503, headers, body: 'printer temporarily unavailable' });
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ connectionId: brother.id, status: { connected: true, ipAddress: '192.0.2.4', ssid: 'Workshop', encryption: 'aes', authentication: 'wpa2-psk', infrastructure: true, wirelessDirect: false } }) });
    }
    if (request.url().endsWith('/brother/wifi/scan')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ connectionId: brother.id, accessPoints: [{ ssid: 'Workshop', channel: 6, power: -42, encrypted: true, enterprise: false }] }) });
    if (request.url().endsWith('/brother/report')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ connectionId: brother.id, redacted: true, sections: { General: { Model: 'QL-1110NWB' } } }) });
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ connections: [brother, generic], connected: false, status: 'not-connected', media: null }) });
  });
  await page.goto('/');
  await expect(page.getByLabel('Printer model')).toBeVisible();
  await openDialog(page, 'Print', 'Local service…');
  const dialog = page.getByRole('dialog', { name: 'Local service' });
  expect(calls).toEqual([]);
  await dialog.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect(dialog.getByText('Brother QL-1110NWB', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Refresh' }).click();
  await expect(dialog.getByRole('button', { name: 'Wi-Fi status' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Scan Wi-Fi' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Redacted report' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /configure wi-fi/i })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Wi-Fi status' }).click();
  await expect(dialog.getByText(/503 Service Unavailable: printer temporarily unavailable/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Wi-Fi status' }).click();
  await expect(dialog.getByLabel('Brother Wi-Fi status')).toContainText('Workshop');
  await dialog.getByRole('button', { name: 'Scan Wi-Fi' }).click();
  await expect(dialog.getByRole('list', { name: 'Brother Wi-Fi networks' })).toContainText('channel 6');
  await dialog.getByRole('button', { name: 'Redacted report' }).click();
  await expect(dialog.getByLabel('Redacted Brother system report')).toContainText('QL-1110NWB');

  await dialog.getByLabel('Printer connection').selectOption('generic-network');
  await expect(dialog.getByRole('button', { name: 'Wi-Fi status' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Scan Wi-Fi' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Redacted report' })).toHaveCount(0);
});

test('configures Brother Wi-Fi only through an explicit admin review and does not persist secrets', async ({ page }) => {
  const brother = { id: 'brother-usb', model: 'ql-1110nwb', status: 'idle', transport: { kind: 'usb', device: 'usb:04f9:209b:serial=E123' }, operations: ['wifi-configure'] };
  const requests: { url: string; body: Record<string, unknown>; authorization: string | undefined }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('mb-local-api-token', 'print-token');
    localStorage.setItem('mb-local-api-connection', 'brother-usb');
  });
  await page.route('http://127.0.0.1:9847/v1/**', async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': request.headers().origin ?? 'http://127.0.0.1:4173', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,idempotency-key', 'access-control-allow-private-network': 'true', 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.url().endsWith('/admin/pair')) {
      expect(request.postDataJSON()).toEqual({ secret: 'admin-once' });
      expect(request.headers().authorization).toBeUndefined();
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ token: 'admin-token', expiresAt: '2030-01-01T00:10:00Z' }) });
    }
    if (request.url().includes('/brother/wifi/') && (request.url().endsWith('/prepare') || request.url().endsWith('/configure'))) {
      requests.push({ url: request.url(), body: request.postDataJSON() as Record<string, unknown>, authorization: request.headers().authorization });
      if (request.url().endsWith('/prepare')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ approvalId: 'approval-1', expiresAt: 1893456000, connection: brother.id, device: brother.transport.device, ssid: 'Workshop', encryption: 'aes', authentication: 'wpa2-psk', infrastructure: true, wirelessDirect: false, reboot: true, recovery: 'Keep USB connected.' }) });
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ connection: brother.id, device: brother.transport.device, applied: true, reboot: true }) });
    }
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ connections: [brother], connected: true, status: 'idle', media: null }) });
  });
  await page.goto('/');
  await openDialog(page, 'Print', 'Local service…');
  const dialog = page.getByRole('dialog', { name: 'Local service' });
  await dialog.getByRole('button', { name: 'Refresh' }).click();
  await expect(dialog.getByRole('button', { name: 'Review Wi-Fi configuration' })).toBeVisible();
  await expect(dialog.getByText('Review before applying')).toHaveCount(0);
  await dialog.getByLabel('One-time administrator pairing secret').fill('admin-once');
  await dialog.getByRole('button', { name: 'Authorize Wi-Fi administration' }).click();
  await expect(dialog.getByText(/Wi-Fi administration authorized until/)).toBeVisible();
  await dialog.getByLabel('Wi-Fi network name').fill('Workshop');
  await dialog.getByLabel('Wi-Fi password').fill('password-that-must-not-persist');
  await dialog.getByRole('button', { name: 'Review Wi-Fi configuration' }).click();
  await expect(dialog.getByLabel('Wi-Fi configuration review')).toContainText('Workshop');
  expect(requests).toHaveLength(1);
  expect(requests[0].authorization).toBe('Bearer admin-token');
  expect(requests[0].body.password).toBe('password-that-must-not-persist');
  await dialog.getByRole('button', { name: 'Apply Wi-Fi configuration' }).click();
  await expect(dialog.getByText(/Wi-Fi configuration sent; printer reboot requested/)).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].body.approvalId).toBe('approval-1');
  expect(requests[1].authorization).toBe('Bearer admin-token');
  await expect(dialog.getByLabel('One-time administrator pairing secret')).toHaveValue('');
  await expect(dialog.getByLabel('Wi-Fi password')).toHaveValue('');
  await dialog.getByLabel('One-time administrator pairing secret').fill('secret-cleared-on-close');
  await dialog.getByLabel('Wi-Fi password').fill('password-cleared-on-close');
  await dialog.getByRole('button', { name: 'Close Local service' }).click();
  await openDialog(page, 'Print', 'Local service…');
  const reopened = page.getByRole('dialog', { name: 'Local service' });
  await reopened.getByRole('button', { name: 'Refresh' }).click();
  await expect(reopened.getByLabel('One-time administrator pairing secret')).toHaveValue('');
  await expect(reopened.getByLabel('Wi-Fi password')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('admin-token');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('password-that-must-not-persist');
});
});

test.describe('local printer pairing', () => {
test.use({ serviceWorkers: 'allow' });
test('pairing is user initiated and replaces the origin-bound browser grant', async ({ page }) => {
  let applicationRequests = 0;
  await page.addInitScript(() => localStorage.setItem('mb-local-api-token', 'old-token'));
  await page.route('http://127.0.0.1:9847/v1/**', async route => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': request.headers()['origin'] ?? 'http://127.0.0.1:4173',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,idempotency-key',
      'access-control-allow-private-network': 'true',
      'content-type': 'application/json'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    applicationRequests++;
    if (request.url().endsWith('/pair')) {
      expect(JSON.parse(request.postData() ?? '{}')).toEqual({ secret: 'one-time' });
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ grantId: 'hosted', token: 'new-token', expiresAt: '2026-09-30T00:00:00Z' }) });
    }
    return route.fulfill({ status: 200, headers, body: JSON.stringify({ connections: [] }) });
  });
  await page.goto('/');
  await openDialog(page, 'Print', 'Local service…');
  expect(applicationRequests).toBe(0);
  await page.getByLabel('One-time pairing secret').fill('one-time');
  await page.getByRole('button', { name: 'Pair on localhost' }).dispatchEvent('click');
  // Pairing is followed by explicit feature negotiation and connection refresh.
  await expect.poll(() => applicationRequests).toBe(3);
  expect(await page.evaluate(() => localStorage.getItem('mb-local-api-token'))).toBe('new-token');
});

test('an unreachable daemon or denied Local Network Access has actionable recovery text', async ({ page }) => {
  await page.route('http://127.0.0.1:9847/v1/**', route => route.abort('connectionrefused'));
  await page.goto('/');
  await openDialog(page, 'Print', 'Local service…');
  await expect(page.getByRole('dialog', { name: 'Local service' }).getByRole('button', { name: 'Discover', exact: true })).toBeDisabled();
  await page.getByLabel('One-time pairing secret').fill('one-time');
  await page.getByRole('button', { name: 'Pair on localhost' }).dispatchEvent('click');
  await expect(page.getByText(/Local service unavailable or Local Network Access was denied/)).toBeVisible();
  await expect(page.getByText(/start mb-printer api, then retry/)).toBeVisible();
});

test('origin rejection and an expired pairing secret have distinct recovery text', async ({ page }) => {
  let status = 403;
  await page.route('http://127.0.0.1:9847/v1/**', async route => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': route.request().headers()['origin'] ?? 'http://127.0.0.1:4173',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type,idempotency-key',
        'access-control-allow-private-network': 'true'
      } });
    }
    return route.fulfill({ status, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await openDialog(page, 'Print', 'Local service…');
  const secret = page.getByLabel('One-time pairing secret');
  await secret.fill('wrong-origin');
  await page.getByRole('button', { name: 'Pair on localhost' }).dispatchEvent('click');
  await expect(page.getByText(/exact editor origin.*LABEL_EDITOR_ORIGINS/i)).toBeVisible();

  status = 401;
  await secret.fill('expired');
  await page.getByRole('button', { name: 'Pair on localhost' }).dispatchEvent('click');
  await expect(page.getByText(/secret expired.*fresh one-time secret/i)).toBeVisible();
});
});

test('touch gestures, rulers, local SVG import, and autosave recovery work',async({page})=>{await page.goto('/');await expect(page.locator('.ruler.horizontal')).toBeVisible();await expect(page.locator('.ruler.vertical')).toBeVisible();const viewport=page.getByRole('application',{name:'Label canvas'});await viewport.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',clientX:200,clientY:100});await viewport.dispatchEvent('pointermove',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await expect(page.locator('input.zoom')).toBeVisible();const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';await openDialog(page,'Label','Assets…');await page.locator('input[type=file][accept*="image"]' ).setInputFiles({name:'local.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible();await page.waitForTimeout(1700);const autosaves=await page.evaluate(async()=>await new Promise<number>((resolve,reject)=>{const request=indexedDB.open('makersbrain-label-editor');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const count=request.result.transaction('autosaves').objectStore('autosaves').count();count.onsuccess=()=>resolve(count.result);count.onerror=()=>reject(count.error)}}));expect(autosaves).toBeGreaterThan(0);await page.reload();await expect(page.locator('footer')).toContainText('Recovered autosave');await openDialog(page,'Label','Assets…');await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible()});

test('wheel navigation and selection keyboard nudging work on the canvas',async({page})=>{await page.goto('/');const viewport=page.getByRole('application',{name:'Label canvas'});const pan=page.locator('.pan');const initial=await pan.getAttribute('style');await viewport.dispatchEvent('wheel',{deltaY:-120,clientX:300,clientY:200});await expect(page.locator('input.zoom')).not.toHaveValue('1');const zoomed=await pan.getAttribute('style');expect(zoomed).not.toBe(initial);await viewport.dispatchEvent('wheel',{deltaY:40,shiftKey:true});const horizontal=await pan.getAttribute('style');expect(horizontal).not.toBe(zoomed);await viewport.dispatchEvent('wheel',{deltaY:40,ctrlKey:true});expect(await pan.getAttribute('style')).not.toBe(horizontal);await page.getByRole('button',{name:'Rectangle',exact:true}).click();const element=page.locator('.element.rectangle');await element.click();await expect(element).toHaveClass(/selected/);const before=await element.getAttribute('style');await page.keyboard.press('ArrowRight');expect(await element.getAttribute('style')).not.toBe(before)});

test('compiled SDK rejects an unknown canonical field before replacing the document',async({page})=>{const fixture=JSON.parse(await readFile(new URL('../../packages/label-editor/tests/fixtures/sdk-v4-text.mb-label.json',import.meta.url),'utf8')) as Record<string,unknown>;fixture.unknownField=true;await page.goto('/');await page.locator('input[type=file][accept*="mb-label"]').setInputFiles({name:'invalid.mb-label.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await expect(page.locator('footer')).toContainText('Document validation failed');await expect(page.locator('footer')).not.toContainText('Opened SDK compatibility')});

test('authoritative SDK renders a zone-local element with one non-origin translation',async({page})=>{await page.goto('/');const bounds=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.js');const sdk=await loadPrinterSdk();const now='2026-01-01T00:00:00Z';const document={version:4 as const,id:'zone-render',title:'Zone render',media:{width:60,height:30,unit:'mm' as const,dpi:203,orientation:'portrait' as const,printableBounds:{x:0,y:0,width:60,height:30},shape:'die-cut' as const,zones:[{id:'right',name:'Right',x:25,y:0,width:20,height:20}]},coordinateSystem:{unit:'mm' as const,origin:'top-left' as const},elements:[{id:'box',name:'Box',type:'rectangle' as const,strokeWidth:.2,filled:true,transform:{x:1,y:2,width:2,height:2,rotation:0},zIndex:0,visible:true,locked:false,constraints:[{kind:'zone' as const,value:'right'}]}],resources:[],fonts:[],createdAt:now,modifiedAt:now};const raster=await sdk.render(document);let minX=raster.width,maxX=-1;for(let offset=0;offset<raster.rgba.length;offset+=4){if(raster.rgba[offset]<128){const x=(offset/4)%raster.width;minX=Math.min(minX,x);maxX=Math.max(maxX,x)}}return{minX,maxX,width:raster.width}});expect(bounds.minX).toBeGreaterThan(200);expect(bounds.minX).toBeLessThan(215);expect(bounds.maxX).toBeLessThan(235)});

test('browser document library saves and reopens a label',async({page})=>{await page.goto('/');await openDialog(page,'Label','Library…');await page.getByRole('button',{name:'Save to browser'}).click();await expect(page.getByText(/Saved Untitled label to this browser/)).toBeVisible();await page.getByRole('button',{name:'New label'}).click();await page.getByRole('button',{name:'Untitled label',exact:true}).click();await expect(page.getByText(/Opened Untitled label from this browser/)).toBeVisible()});

test('offline WASM exports PNG/PDF and imports the first PDF page',async({page})=>{await page.goto('/');const result=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.js');const sdk=await loadPrinterSdk();const now='2026-01-01T00:00:00Z';const document={version:4 as const,id:'pdf-roundtrip',title:'PDF',media:{width:50,height:30,unit:'mm' as const,dpi:203,orientation:'portrait' as const,printableBounds:{x:0,y:0,width:50,height:30},shape:'die-cut' as const},coordinateSystem:{unit:'mm' as const,origin:'top-left' as const},elements:[],resources:[],fonts:[],createdAt:now,modifiedAt:now};const png=await sdk.exportPng(document);const pdf=await sdk.exportPdf([document]);const imported=await sdk.importFirstPdfPage(pdf,203);return{png:[...png.slice(0,8)],pdf:[...pdf.slice(0,4)],width:imported.widthMm,height:imported.heightMm}});expect(result.png).toEqual([137,80,78,71,13,10,26,10]);expect(result.pdf).toEqual([37,80,68,70]);expect(result.width).toBeCloseTo(50,1);expect(result.height).toBeCloseTo(30,1)});

test('classic sheet preview and PDF export use the compiled Rust planner', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Printer model').focus();
  await page.locator('.menubar').getByText('Print', { exact: true }).click();
  await page.getByRole('button', { name: 'Label sheet…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Label sheet' });
  await dialog.getByRole('combobox', { name: 'Label sheet' }).selectOption({ label: 'Custom grid…' });
  await expect(dialog.getByLabel('First unused label')).toBeVisible();
  await expect(dialog.getByText(/1 page · 24 labels per full sheet/)).toBeVisible();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export sheet PDF' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('label-sheet.pdf');
  const path = await download.path();
  expect(path).toBeTruthy();
  expect((await readFile(path!)).subarray(0, 4).toString()).toBe('%PDF');
  await expect(page.locator('footer')).toContainText('Sheet PDF ready: 1 page.');
});

test('File System Access open picker validates and opens v4',async({page})=>{const fixture=await readFile(new URL('../../packages/label-editor/tests/fixtures/sdk-v4-text.mb-label.json',import.meta.url),'utf8');await page.addInitScript(source=>Object.defineProperty(window,'showOpenFilePicker',{value:async()=>[{getFile:async()=>new File([source],'picker.mb-label.json',{type:'application/json'})}]}),fixture);await page.goto('/');await page.getByText('File',{exact:true}).click();await page.getByRole('button',{name:'Open picker'}).click();await expect(page.locator('footer')).toContainText('Opened SDK compatibility')});

test('canvas elements stay unfilled on hover and the grid survives the thermal preview',async({page})=>{await page.goto('/');await page.getByRole('button',{name:'Text',exact:true}).click();const element=page.locator('.element').first();await element.hover();expect(await element.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');await page.getByLabel('Printer model').focus();const raster=page.locator('.media canvas');await expect(raster).toBeAttached({timeout:10000});expect(await raster.evaluate(node=>getComputedStyle(node).mixBlendMode)).toBe('multiply');expect(await page.locator('.media').evaluate(node=>getComputedStyle(node).backgroundImage)).toContain('linear-gradient')});

test('the thermal preview resamples the printer raster to the size it is shown at',async({page})=>{await page.goto('/');
  // Hairline strokes vanish under nearest-neighbour downscaling, which is exactly what the preview must avoid.
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="0.4">'+Array.from({length:20},(_,i)=>`<circle cx="50" cy="50" r="${2+i*2.3}"/>`).join('')+'</svg>';
  await openDialog(page,'Label','Assets…');
  await page.locator('input[type=file][accept*="image"]').setInputFiles({name:'rings.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await expect(page.getByText('rings.svg',{exact:true}).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Printer model').focus();
  const raster=page.locator('canvas[aria-label="Exact thermal SDK preview"]');
  await expect(raster).toBeAttached({timeout:10000});
  await expect.poll(async()=>raster.evaluate(node=>(node as HTMLCanvasElement).width),{timeout:10000}).toBeGreaterThan(0);
  await page.locator('.media').screenshot({path:process.env.MB_PREVIEW_SHOT??'test-results/thermal-preview.png'});
  const sizes=await raster.evaluate(node=>{const canvas=node as HTMLCanvasElement;const shown=canvas.getBoundingClientRect();return{backing:canvas.width,shown:shown.width*devicePixelRatio,dpiWidth:Math.round(canvas.clientWidth/3.7795275591*300/25.4),rendering:getComputedStyle(canvas).imageRendering}});
  expect(sizes.backing).toBeLessThan(sizes.dpiWidth);
  expect(Math.abs(sizes.backing-sizes.shown)).toBeLessThanOrEqual(2);
  expect(sizes.rendering).not.toBe('pixelated');
  const ink=await raster.evaluate(node=>{const canvas=node as HTMLCanvasElement;const data=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let dark=0;for(let i=0;i<data.length;i+=4)if(data[i]<200)dark++;return dark/(data.length/4)});
  expect(ink).toBeGreaterThan(0.02);
});
test('webp imports transcode to a printable halftone png',async({page})=>{await page.goto('/');
  const webp=await page.evaluate(async()=>{const canvas=new OffscreenCanvas(48,48);const context=canvas.getContext('2d')!;const gradient=context.createLinearGradient(0,0,48,48);gradient.addColorStop(0,'#000');gradient.addColorStop(1,'#fff');context.fillStyle=gradient;context.fillRect(0,0,48,48);return [...new Uint8Array(await (await canvas.convertToBlob({type:'image/webp'})).arrayBuffer())]});
  await openDialog(page,'Label','Assets…');
  const imageInput=page.locator('input[type=file][accept*="webp"]');
  await imageInput.setInputFiles({name:'photo.webp',mimeType:'image/webp',buffer:Buffer.from(webp)});
  // Placing the same cached bytes again must keep the second resource ID valid.
  await imageInput.setInputFiles({name:'photo.webp',mimeType:'image/webp',buffer:Buffer.from(webp)});
  await expect(page.getByText('Imported and placed photo.webp')).toBeVisible();
  await page.getByRole('button',{name:'Close Assets'}).click();
  await expect(page.locator('img.asset')).toHaveCount(2);
  const asset=page.locator('img.asset').first();
  await expect(asset).toBeAttached();
  expect(await asset.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  const tones=await asset.evaluate(async(node:HTMLImageElement)=>{await node.decode();const canvas=document.createElement('canvas');canvas.width=node.naturalWidth;canvas.height=node.naturalHeight;const context=canvas.getContext('2d')!;context.drawImage(node,0,0);const{data}=context.getImageData(0,0,canvas.width,canvas.height);let black=0,white=0;for(let index=0;index<data.length;index+=4)data[index]<128?black++:white++;return{black,white}});
  expect(tones.black).toBeGreaterThan(0);expect(tones.white).toBeGreaterThan(0);
  await page.getByLabel('Printer model').focus();
  await expect(page.locator('.media canvas')).toBeAttached({timeout:10000});
  await expect(page.locator('.media ~ .error, .error')).toHaveCount(0)});

test('the compiled SDK builds a Brother status plan and decodes the reply',async({page})=>{await page.goto('/');
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.js');const sdk=await loadPrinterSdk();const printers=await sdk.printerDefinitions();
    const brother=printers.find(item=>item.id==='ql-1110nwb')!;const plan=await sdk.statusPlan!(brother);
    const reply=new Uint8Array(32);reply.set([0x80,0x20,0x42]);reply[10]=62;reply[11]=0x0b;reply[17]=29;reply[8]=1;
    const parsed=await sdk.parseStatus!(brother,[reply]);
    let unsupported='';try{await sdk.statusPlan!(printers.find(item=>item.id==='pm241')!)}catch(error){unsupported=(error as Error).message??String(error)}
    return{request:[...(plan.actions.filter(action=>action.type==='write').at(-1) as {data:Uint8Array}).data],last:plan.actions.at(-1)?.type,validate:(plan.actions.at(-1) as {validate?:string}).validate,
      raster:plan.actions.some(action=>action.type==='write'&&action.chunkable),
      status:{width:parsed.mediaWidthMm,length:parsed.mediaLengthMm,type:parsed.mediaType,errors:parsed.errors},unsupported}});
  expect(probe.request).toEqual([0x1b,0x69,0x53]);expect(probe.last).toBe('wait-response');expect(probe.validate).toBe('brother-status32');expect(probe.raster).toBe(false);
  expect(probe.status).toEqual({width:62,length:29,type:'die-cut',errors:['no media']});
  expect(probe.unsupported).toMatch(/does not support/)});

test('the compiled SDK queries Phomemo status and decodes notification frames',async({page})=>{await page.goto('/');
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.js');const sdk=await loadPrinterSdk();const printers=await sdk.printerDefinitions();
    const phomemo=printers.find(item=>item.id==='m110')!;const plan=await sdk.statusPlan!(phomemo);
    const parsed=await sdk.parseStatus!(phomemo,[Uint8Array.from([0x1a,0x04,0xa2]),Uint8Array.from([0x1a,0x05,0x98]),Uint8Array.from([0x1a,0x06,0x88]),Uint8Array.from([0x1a,0x08,0x4d,0x42,0x31])]);
    return{subscribes:plan.actions[0]?.type,queries:plan.actions.filter(action=>action.type==='write').map(action=>[...(action as {data:Uint8Array}).data]),
      status:{battery:parsed.battery,cover:parsed.cover,paper:parsed.paper,serial:parsed.serial,errors:parsed.errors}}});
  expect(probe.subscribes).toBe('subscribe');
  expect(probe.queries[0]).toEqual([0x1f,0x11,0x08]);
  expect(probe.queries).toHaveLength(6);
  expect(probe.status).toEqual({battery:5,cover:'closed',paper:'out',serial:'MB1',errors:['no media']})});

test('the SDK lists the media a model can carry and names what it reported',async({page})=>{await page.goto('/');
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.js');const sdk=await loadPrinterSdk();const printers=await sdk.printerDefinitions();
    const find=(id:string)=>printers.find(item=>item.id===id)!;
    const list=async(id:string)=>(await sdk.mediaPresets!(find(id))).map(item=>item.id);
    const brother=await sdk.mediaPresets!(find('ql-1110nwb'));
    const reply=new Uint8Array(32);reply.set([0x80,0x20,0x42]);reply[10]=62;reply[11]=0x0b;reply[17]=29;
    const status=await sdk.parseStatus!(find('ql-1110nwb'),[reply]);
    return{brother:brother.map(item=>item.id),narrow:await list('m110'),wide:await list('m200'),tape:await list('p12'),media:status.media?.name}});
  expect(probe.brother).toContain('62x29');
  expect(probe.brother).toContain('102x152');
  expect(probe.narrow).toContain('40x30');
  expect(probe.narrow).not.toContain('60x40');
  expect(probe.wide).toContain('60x40');
  expect(probe.tape.every(id=>['30x6','50x12','40x12','30x12'].includes(id))).toBe(true);
  expect(probe.media).toBe('62mm x 29mm')});

test('the label takes its size from the media the printer reports',async({page})=>{await page.goto('/');
  await page.getByLabel('Printer model').focus();
  await page.getByLabel('Printer model').selectOption('ql-1110nwb');
  // Answer the status query from a stub transport instead of real hardware.
  await page.evaluate(()=>{const reply=new Uint8Array(32);reply.set([0x80,0x20,0x42]);reply[10]=62;reply[11]=0x0b;reply[17]=29;
    const device={opened:true,configuration:{interfaces:[{interfaceNumber:0,alternates:[{alternateSetting:0,endpoints:[{direction:'out',type:'bulk',endpointNumber:1,packetSize:64},{direction:'in',type:'bulk',endpointNumber:2,packetSize:64}]}]}]},open:async()=>{},close:async()=>{},selectConfiguration:async()=>{},claimInterface:async()=>{},selectAlternateInterface:async()=>{},transferOut:async(_endpoint:number,data:ArrayBuffer)=>({status:'ok',bytesWritten:data.byteLength}),transferIn:async()=>({status:'ok',data:new DataView(reply.buffer)})};
    // navigator.usb is a prototype accessor, so it has to be replaced outright.
    Object.defineProperty(navigator,'usb',{configurable:true,value:{requestDevice:async()=>device}})});
  await page.getByLabel('Connection').selectOption('usb');
  await page.getByRole('button',{name:'Connect'}).click();
  await expect(page.locator('.media-summary')).toContainText('62mm x 29mm');
  await expect(page.locator('footer')).toContainText('Label media set to 62 × 29 mm');
  await page.getByLabel('Editor menus').getByText('Label',{exact:true}).click();
  await page.getByRole('button',{name:'Media & zones…'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('width')).toHaveValue('62');
  await expect(dialog.getByLabel('height')).toHaveValue('29')});

test('printer-reported continuous stock sets roll width without discarding authored length',async({page})=>{await page.goto('/');
  await page.getByLabel('Printer model').selectOption('ql-1110nwb');
  const authoredLength=30;
  await page.evaluate(()=>{const reply=new Uint8Array(32);reply.set([0x80,0x20,0x42]);reply[10]=62;reply[11]=0x0a;reply[17]=0;
    const device={opened:true,configuration:{interfaces:[{interfaceNumber:0,alternates:[{alternateSetting:0,endpoints:[{direction:'out',type:'bulk',endpointNumber:1,packetSize:64},{direction:'in',type:'bulk',endpointNumber:2,packetSize:64}]}]}]},open:async()=>{},close:async()=>{},selectConfiguration:async()=>{},claimInterface:async()=>{},selectAlternateInterface:async()=>{},transferOut:async(_endpoint:number,data:ArrayBuffer)=>({status:'ok',bytesWritten:data.byteLength}),transferIn:async()=>({status:'ok',data:new DataView(reply.buffer)})};
    Object.defineProperty(navigator,'usb',{configurable:true,value:{requestDevice:async()=>device}})});
  await page.getByLabel('Connection').selectOption('usb');
  await page.getByRole('button',{name:'Connect'}).click();
  await expect(page.locator('footer')).toContainText(`Label media set to 62 × ${authoredLength} mm`);
  await openDialog(page,'Label','Media & zones…');
  const dialog=page.getByRole('dialog',{name:'Media & zones'});
  await expect(dialog.getByLabel('Shape')).toHaveValue('continuous');
  await expect(dialog.getByLabel('Roll width (mm)')).toHaveValue('62');
  await expect(dialog.getByLabel('Cut length (mm)')).toHaveValue(String(authoredLength));
});

test('the print route follows the selected printer and stays where it is put',async({page})=>{await page.goto('/');
  await page.getByLabel('Printer model').focus();
  const route=page.getByLabel('Connection');
  await page.getByLabel('Printer model').selectOption('m110');
  await expect(route).toHaveValue('bluetooth');
  await page.getByLabel('Printer model').selectOption('ql-1110nwb');
  await expect(route).toHaveValue('usb');
  // A choice of its own outranks the printer.
  await route.selectOption('bluetooth');
  await page.getByLabel('Printer model').selectOption('m110');
  await expect(route).toHaveValue('bluetooth')});

test('the compiled SDK drops the pacing when the transport streams and compresses on request',async({page})=>{await page.goto('/');
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.js');const sdk=await loadPrinterSdk();const printer=(await sdk.printerDefinitions()).find(item=>item.id==='m110')!;
    const document={version:4 as const,id:'pace',title:'Pace',media:{width:40,height:30,unit:'mm' as const,dpi:203,orientation:'portrait' as const,printableBounds:{x:0,y:0,width:40,height:30},shape:'rectangle' as const},coordinateSystem:{unit:'mm' as const,origin:'top-left' as const},elements:[],resources:[],fonts:[],createdAt:'2026-01-01T00:00:00Z',modifiedAt:'2026-01-01T00:00:00Z'};
    const bytes=async(options:Record<string,unknown>)=>{const plan=await sdk.plan(document as never,printer,{copies:1,...options});
      const raster=plan.actions.find(action=>action.type==='write'&&action.chunkable) as {data:Uint8Array;delayAfterMs:number};
      return{delay:raster.delayAfterMs,length:raster.data.length}};
    return{paced:await bytes({}),streamed:await bytes({streaming:true}),compressed:await bytes({streaming:true,lzo:true})}});
  expect(probe.paced.delay).toBe(20);
  expect(probe.streamed.delay).toBe(0);
  expect(probe.streamed.length).toBe(probe.paced.length);
  // An empty label is almost entirely one repeated byte, so LZO shrinks it hard.
  expect(probe.compressed.length).toBeLessThan(probe.streamed.length/4)});

test('a dialog the app mounts outside the editor still carries its styling',async({page})=>{await page.goto('/');
  await page.getByLabel('Printer model').focus();
  await page.locator('.menubar').getByText('Print',{exact:true}).click();
  await page.getByRole('button',{name:'Local service…'}).click();
  const styling=await page.evaluate(()=>{const dialog=document.querySelector('[role=dialog]') as HTMLElement;
    const label=dialog.querySelector('label') as HTMLElement;const button=dialog.querySelector('button') as HTMLElement;
    return{scoped:dialog.classList.contains('mb-label-editor'),label:getComputedStyle(label).fontSize,button:getComputedStyle(button).fontSize,body:getComputedStyle(document.body).fontSize}});
  expect(styling.scoped).toBe(true);
  // The host's own body type is larger; the dialog must not inherit it.
  expect(styling.button).toBe('13px');
  expect(styling.body).not.toBe('13px')});

test('WebUSB offers every attached printer without an identity',async({page})=>{await page.goto('/');
  await page.getByLabel('Printer model').selectOption('m200');
  await page.getByLabel('Connection').selectOption('usb');
  await expect(page.getByLabel('Vendor ID')).toBeHidden();
  const filters=await page.evaluate(async()=>{let captured:unknown;
    Object.defineProperty(navigator,'usb',{configurable:true,value:{requestDevice:async(options:{filters:unknown})=>{captured=options.filters;throw new DOMException('cancelled','NotFoundError')}}});
    document.querySelectorAll('button').forEach(button=>{if(button.textContent?.trim()==='Connect')button.click()});
    await new Promise(resolve=>setTimeout(resolve,400));return captured});
  expect(filters).toEqual([{classCode:7}])});

test('continuous cutter preferences are isolated by printer model',async({page})=>{await page.goto('/');
  await openDialog(page,'Label','Media & zones…');
  const media=page.getByRole('dialog',{name:'Media & zones'});
  await media.getByLabel('Shape').selectOption('continuous');
  await media.getByRole('button',{name:'Close Media & zones'}).click();
  const printer=page.getByLabel('Printer model');const cut=page.locator('fieldset').filter({hasText:'Continuous roll'}).locator('select');
  await printer.selectOption('ql-1110nwb');
  await cut.selectOption('none');
  await printer.selectOption('ql-1115nwb');
  await expect(cut).toHaveValue('after-each');
  await printer.selectOption('ql-1110nwb');
  await expect(cut).toHaveValue('none');
  await page.waitForTimeout(100);
  await page.reload();
  await expect(printer).toHaveValue('ql-1110nwb');
  await openDialog(page,'Label','Media & zones…');
  const restoredMedia=page.getByRole('dialog',{name:'Media & zones'});
  await restoredMedia.getByLabel('Shape').selectOption('continuous');
  await restoredMedia.getByRole('button',{name:'Close Media & zones'}).click();
  await expect(cut).toHaveValue('none')});
