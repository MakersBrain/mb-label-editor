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

test.describe('local printer persistence', () => {
test.use({ serviceWorkers: 'block' });
test('a saved IPP connection is restored and shown in the printer sidebar', async ({ page }) => {
  const connection = { id: 'brother-network', model: 'ql-1110nwb', status: 'idle', transport: { kind: 'ipp', uri: 'ipp://10.83.30.114:631/ipp/print' }, media: { widthMm: 29, lengthMm: 62, keyword: 'om_brother-label-29x62mm_29x62mm' } };
  await page.addInitScript(() => {
    localStorage.setItem('mb-local-api-token', 'test-token');
    localStorage.setItem('mb-local-api-connection', 'brother-network');
  });
  await page.route('http://127.0.0.1:9847/v1/**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers()['origin'] ?? 'http://127.0.0.1:4173', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,idempotency-key', 'access-control-allow-private-network': 'true', 'content-type': 'application/json' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const selected = new URL(route.request().url()).searchParams.has('connection');
    return route.fulfill({ status: 200, headers, body: JSON.stringify(selected ? { connection, connected: true, status: 'idle', media: connection.media } : { connections: [connection], connected: false, status: 'not-connected', media: null }) });
  });
  await page.goto('/');
  const selector = page.getByLabel('Connection');
  await expect(selector).toHaveValue('local');
  await expect(selector.locator('option:checked')).toHaveText('IPP · brother-network');
  await expect(page.getByLabel('Printer model')).toHaveValue('ql-1110nwb');
  await expect(page.getByText(/Saved by the local service as brother-network/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Saved by the local service as brother-network/)).toBeVisible();
  await expect(page.getByLabel('Connection')).toHaveValue('local');
});
});

test('touch gestures, rulers, local SVG import, and autosave recovery work',async({page})=>{await page.goto('/');await expect(page.locator('.ruler.horizontal')).toBeVisible();await expect(page.locator('.ruler.vertical')).toBeVisible();const viewport=page.getByRole('application',{name:'Label canvas'});await viewport.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',clientX:200,clientY:100});await viewport.dispatchEvent('pointermove',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',clientX:100,clientY:100});await viewport.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch',clientX:260,clientY:100});await expect(page.locator('input.zoom')).toBeVisible();const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';await openDialog(page,'Label','Assets…');await page.locator('input[type=file][accept*="image"]' ).setInputFiles({name:'local.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible();await page.waitForTimeout(1700);const autosaves=await page.evaluate(async()=>await new Promise<number>((resolve,reject)=>{const request=indexedDB.open('makersbrain-label-editor');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const count=request.result.transaction('autosaves').objectStore('autosaves').count();count.onsuccess=()=>resolve(count.result);count.onerror=()=>reject(count.error)}}));expect(autosaves).toBeGreaterThan(0);await page.reload();await expect(page.locator('footer')).toContainText('Recovered autosave');await openDialog(page,'Label','Assets…');await expect(page.getByText('local.svg',{exact:true}).first()).toBeVisible()});

test('wheel navigation and selection keyboard nudging work on the canvas',async({page})=>{await page.goto('/');const viewport=page.getByRole('application',{name:'Label canvas'});const pan=page.locator('.pan');const initial=await pan.getAttribute('style');await viewport.dispatchEvent('wheel',{deltaY:-120,clientX:300,clientY:200});await expect(page.locator('input.zoom')).not.toHaveValue('1');const zoomed=await pan.getAttribute('style');expect(zoomed).not.toBe(initial);await viewport.dispatchEvent('wheel',{deltaY:40,shiftKey:true});const horizontal=await pan.getAttribute('style');expect(horizontal).not.toBe(zoomed);await viewport.dispatchEvent('wheel',{deltaY:40,ctrlKey:true});expect(await pan.getAttribute('style')).not.toBe(horizontal);await page.getByRole('button',{name:'Rectangle',exact:true}).click();const element=page.locator('.element.rectangle');await element.click();await expect(element).toHaveClass(/selected/);const before=await element.getAttribute('style');await page.keyboard.press('ArrowRight');expect(await element.getAttribute('style')).not.toBe(before)});

test('compiled SDK rejects an unknown canonical field before replacing the document',async({page})=>{const fixture=JSON.parse(await readFile(new URL('../../packages/label-editor/tests/fixtures/sdk-v4-text.mb-label.json',import.meta.url),'utf8')) as Record<string,unknown>;fixture.unknownField=true;await page.goto('/');await page.locator('input[type=file][accept*="mb-label"]').setInputFiles({name:'invalid.mb-label.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await expect(page.locator('footer')).toContainText('Document validation failed');await expect(page.locator('footer')).not.toContainText('Opened SDK compatibility')});

test('authoritative SDK renders a zone-local element with one non-origin translation',async({page})=>{await page.goto('/');const bounds=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const now='2026-01-01T00:00:00Z';const document={version:4 as const,id:'zone-render',title:'Zone render',media:{width:60,height:30,unit:'mm' as const,dpi:203,orientation:'portrait' as const,printableBounds:{x:0,y:0,width:60,height:30},shape:'die-cut' as const,zones:[{id:'right',name:'Right',x:25,y:0,width:20,height:20}]},coordinateSystem:{unit:'mm' as const,origin:'top-left' as const},elements:[{id:'box',name:'Box',type:'rectangle' as const,strokeWidth:.2,filled:true,transform:{x:1,y:2,width:2,height:2,rotation:0},zIndex:0,visible:true,locked:false,constraints:[{kind:'zone' as const,value:'right'}]}],resources:[],fonts:[],createdAt:now,modifiedAt:now};const raster=await sdk.render(document);let minX=raster.width,maxX=-1;for(let offset=0;offset<raster.rgba.length;offset+=4){if(raster.rgba[offset]<128){const x=(offset/4)%raster.width;minX=Math.min(minX,x);maxX=Math.max(maxX,x)}}return{minX,maxX,width:raster.width}});expect(bounds.minX).toBeGreaterThan(200);expect(bounds.minX).toBeLessThan(215);expect(bounds.maxX).toBeLessThan(235)});

test('browser document library saves and reopens a label',async({page})=>{await page.goto('/');await openDialog(page,'Label','Library…');await page.getByRole('button',{name:'Save to browser'}).click();await expect(page.getByText(/Saved Untitled label to this browser/)).toBeVisible();await page.getByRole('button',{name:'New label'}).click();await page.getByRole('button',{name:'Untitled label',exact:true}).click();await expect(page.getByText(/Opened Untitled label from this browser/)).toBeVisible()});

test('offline WASM exports PNG/PDF and imports the first PDF page',async({page})=>{await page.goto('/');const result=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const now='2026-01-01T00:00:00Z';const document={version:4 as const,id:'pdf-roundtrip',title:'PDF',media:{width:50,height:30,unit:'mm' as const,dpi:203,orientation:'portrait' as const,printableBounds:{x:0,y:0,width:50,height:30},shape:'die-cut' as const},coordinateSystem:{unit:'mm' as const,origin:'top-left' as const},elements:[],resources:[],fonts:[],createdAt:now,modifiedAt:now};const png=await sdk.exportPng(document);const pdf=await sdk.exportPdf([document]);const imported=await sdk.importFirstPdfPage(pdf,203);return{png:[...png.slice(0,8)],pdf:[...pdf.slice(0,4)],width:imported.widthMm,height:imported.heightMm}});expect(result.png).toEqual([137,80,78,71,13,10,26,10]);expect(result.pdf).toEqual([37,80,68,70]);expect(result.width).toBeCloseTo(50,1);expect(result.height).toBeCloseTo(30,1)});

test('File System Access open picker validates and opens v4',async({page})=>{const fixture=await readFile(new URL('../../packages/label-editor/tests/fixtures/sdk-v4-text.mb-label.json',import.meta.url),'utf8');await page.addInitScript(source=>Object.defineProperty(window,'showOpenFilePicker',{value:async()=>[{getFile:async()=>new File([source],'picker.mb-label.json',{type:'application/json'})}]}),fixture);await page.goto('/');await page.getByText('File',{exact:true}).click();await page.getByRole('button',{name:'Open picker'}).click();await expect(page.locator('footer')).toContainText('Opened SDK compatibility')});

test('canvas elements stay unfilled on hover and the grid survives the thermal preview',async({page})=>{await page.goto('/');await page.getByRole('button',{name:'Text',exact:true}).click();const element=page.locator('.element').first();await element.hover();expect(await element.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');await page.getByLabel('Printer model').focus();const raster=page.locator('.media canvas');await expect(raster).toBeAttached({timeout:10000});expect(await raster.evaluate(node=>getComputedStyle(node).mixBlendMode)).toBe('multiply');expect(await page.locator('.media').evaluate(node=>getComputedStyle(node).backgroundImage)).toContain('linear-gradient')});

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
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const printers=await sdk.printerDefinitions();
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
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const printers=await sdk.printerDefinitions();
    const phomemo=printers.find(item=>item.id==='m110')!;const plan=await sdk.statusPlan!(phomemo);
    const parsed=await sdk.parseStatus!(phomemo,[Uint8Array.from([0x1a,0x04,0xa2]),Uint8Array.from([0x1a,0x05,0x98]),Uint8Array.from([0x1a,0x06,0x88]),Uint8Array.from([0x1a,0x08,0x4d,0x42,0x31])]);
    return{subscribes:plan.actions[0]?.type,queries:plan.actions.filter(action=>action.type==='write').map(action=>[...(action as {data:Uint8Array}).data]),
      status:{battery:parsed.battery,cover:parsed.cover,paper:parsed.paper,serial:parsed.serial,errors:parsed.errors}}});
  expect(probe.subscribes).toBe('subscribe');
  expect(probe.queries[0]).toEqual([0x1f,0x11,0x08]);
  expect(probe.queries).toHaveLength(6);
  expect(probe.status).toEqual({battery:5,cover:'closed',paper:'out',serial:'MB1',errors:['no media']})});

test('the SDK lists the media a model can carry and names what it reported',async({page})=>{await page.goto('/');
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const printers=await sdk.printerDefinitions();
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
  await page.getByText('Label',{exact:true}).click();
  await page.getByRole('button',{name:'Media & zones…'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('width')).toHaveValue('62');
  await expect(dialog.getByLabel('height')).toHaveValue('29')});

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
  const probe=await page.evaluate(async()=>{const{loadPrinterSdk}=await import('/src/sdk.ts');const sdk=await loadPrinterSdk();const printer=(await sdk.printerDefinitions()).find(item=>item.id==='m110')!;
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
  await page.getByLabel('Printer model').focus();
  await page.getByLabel('Connection').selectOption('usb');
  await expect(page.getByLabel('Vendor ID')).toBeHidden();
  const filters=await page.evaluate(async()=>{let captured:unknown;
    Object.defineProperty(navigator,'usb',{configurable:true,value:{requestDevice:async(options:{filters:unknown})=>{captured=options.filters;throw new DOMException('cancelled','NotFoundError')}}});
    document.querySelectorAll('button').forEach(button=>{if(button.textContent?.trim()==='Connect')button.click()});
    await new Promise(resolve=>setTimeout(resolve,400));return captured});
  expect(filters).toEqual([{classCode:7}])});
