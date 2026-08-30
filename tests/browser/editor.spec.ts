// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/** Opens a menu-bar dialog, e.g. Label > Assets…. */
async function openDialog(page: Page, menu: string, item: string) {
  await page.getByText(menu, { exact: true }).click();
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

test('touch gestures, rulers, local SVG import, and autosave recovery work',async({page})=>{await page.goto('/');await expect(page.locator('.ruler.horizontal')).toBeVisible();await expect(page.locator('.ruler.vertical')).toBeVisible();const viewport=page.getByRole('application',{name:'Label canvas'});await viewport.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',clientX:200,clientY:100});await viewport.dispatchEvent('pointermove',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await expect(page.locator('input.zoom')).toBeVisible();const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';await openDialog(page,'Label','Assets…');await page.locator('input[type=file][accept*="image"]' ).setInputFiles({name:'local.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible();await page.waitForTimeout(1700);const autosaves=await page.evaluate(async()=>await new Promise<number>((resolve,reject)=>{const request=indexedDB.open('makersbrain-label-editor');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const count=request.result.transaction('autosaves').objectStore('autosaves').count();count.onsuccess=()=>resolve(count.result);count.onerror=()=>reject(count.error)}}));expect(autosaves).toBeGreaterThan(0);await page.reload();await expect(page.locator('footer')).toContainText('Recovered autosave');await openDialog(page,'Label','Assets…');await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible()});

test('compiled SDK rejects an unknown canonical field before replacing the document',async({page})=>{const fixture=JSON.parse(await readFile(new URL('../../packages/label-editor/tests/fixtures/sdk-v4-text.mb-label.json',import.meta.url),'utf8')) as Record<string,unknown>;fixture.unknownField=true;await page.goto('/');await page.locator('input[type=file][accept*="mb-label"]').setInputFiles({name:'invalid.mb-label.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await expect(page.locator('footer')).toContainText('Document validation failed');await expect(page.locator('footer')).not.toContainText('Opened SDK compatibility')});

test('authoritative SDK renders a zone-local element with one non-origin translation',async({page})=>{await page.goto('/');const bounds=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const now='2026-01-01T00:00:00Z';const document={version:4 as const,id:'zone-render',title:'Zone render',media:{width:60,height:30,unit:'mm' as const,dpi:203,orientation:'portrait' as const,printableBounds:{x:0,y:0,width:60,height:30},shape:'die-cut' as const,zones:[{id:'right',name:'Right',x:25,y:0,width:20,height:20}]},coordinateSystem:{unit:'mm' as const,origin:'top-left' as const},elements:[{id:'box',name:'Box',type:'rectangle' as const,strokeWidth:.2,filled:true,transform:{x:1,y:2,width:2,height:2,rotation:0},zIndex:0,visible:true,locked:false,constraints:[{kind:'zone' as const,value:'right'}]}],resources:[],fonts:[],createdAt:now,modifiedAt:now};const raster=await sdk.render(document);let minX=raster.width,maxX=-1;for(let offset=0;offset<raster.rgba.length;offset+=4){if(raster.rgba[offset]<128){const x=(offset/4)%raster.width;minX=Math.min(minX,x);maxX=Math.max(maxX,x)}}return{minX,maxX,width:raster.width}});expect(bounds.minX).toBeGreaterThan(200);expect(bounds.minX).toBeLessThan(215);expect(bounds.maxX).toBeLessThan(235)});

test('browser document library saves and reopens a label',async({page})=>{await page.goto('/');await openDialog(page,'Label','Library…');await page.getByRole('button',{name:'Save to browser'}).click();await expect(page.getByText(/Saved Untitled label to this browser/)).toBeVisible();await page.getByRole('button',{name:'New label'}).click();await page.getByRole('button',{name:'Untitled label',exact:true}).click();await expect(page.getByText(/Opened Untitled label from this browser/)).toBeVisible()});

test('offline WASM exports PNG/PDF and imports the first PDF page',async({page})=>{await page.goto('/');const result=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const now='2026-01-01T00:00:00Z';const document={version:4 as const,id:'pdf-roundtrip',title:'PDF',media:{width:50,height:30,unit:'mm' as const,dpi:203,orientation:'portrait' as const,printableBounds:{x:0,y:0,width:50,height:30},shape:'die-cut' as const},coordinateSystem:{unit:'mm' as const,origin:'top-left' as const},elements:[],resources:[],fonts:[],createdAt:now,modifiedAt:now};const png=await sdk.exportPng(document);const pdf=await sdk.exportPdf([document]);const imported=await sdk.importFirstPdfPage(pdf,203);return{png:[...png.slice(0,8)],pdf:[...pdf.slice(0,4)],width:imported.widthMm,height:imported.heightMm}});expect(result.png).toEqual([137,80,78,71,13,10,26,10]);expect(result.pdf).toEqual([37,80,68,70]);expect(result.width).toBeCloseTo(50,1);expect(result.height).toBeCloseTo(30,1)});

test('File System Access open picker validates and opens v4',async({page})=>{const fixture=await readFile(new URL('../../packages/label-editor/tests/fixtures/sdk-v4-text.mb-label.json',import.meta.url),'utf8');await page.addInitScript(source=>Object.defineProperty(window,'showOpenFilePicker',{value:async()=>[{getFile:async()=>new File([source],'picker.mb-label.json',{type:'application/json'})}]}),fixture);await page.goto('/');await page.getByText('File',{exact:true}).click();await page.getByRole('button',{name:'Open picker'}).click();await expect(page.locator('footer')).toContainText('Opened SDK compatibility')});

test('canvas elements stay unfilled on hover and the grid survives the thermal preview',async({page})=>{await page.goto('/');await page.getByRole('button',{name:'Text',exact:true}).click();const element=page.locator('.element').first();await element.hover();expect(await element.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');await page.getByLabel('Printer model').focus();const raster=page.locator('.media canvas');await expect(raster).toBeAttached({timeout:10000});expect(await raster.evaluate(node=>getComputedStyle(node).mixBlendMode)).toBe('multiply');expect(await page.locator('.media').evaluate(node=>getComputedStyle(node).backgroundImage)).toContain('linear-gradient')});
