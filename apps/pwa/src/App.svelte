<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import {onMount} from 'svelte';
  import {BrandLockup} from '@makersbrain/ui/svelte';
  import { BatchPanel,DirectPrintPanel,JobRecoveryPanel,JobJournal,LabelEditor,LaPostePanel,LocalServicePanel,createEditorStore,defaultDocument,EditorDatabase,createAutosaver,openDocument,saveDocument,LocalApiPrintRoute,Modal,Menu,type LocalApiConnection,type PrinterSdk,type PrinterDefinition,type PrintProgress,type PrintRoute } from '@makersbrain/label-editor'; import {loadPrinterSdk} from './sdk.js';
  const editor=createEditorStore(defaultDocument()); const database=new EditorDatabase(); const autosave=createAutosaver(database); let status='Ready'; let sdk:PrinterSdk|undefined;let printers:PrinterDefinition[]=[];let printerId='';let progress:PrintProgress|undefined;let apiToken=localStorage.getItem('mb-local-api-token')??'';let connectionId=localStorage.getItem('mb-local-api-connection')??'';let localConnection:LocalApiConnection|undefined;let handle:unknown;let online=navigator.onLine;let theme:'system'|'light'|'dark'='system';let defaultRoute='local-api';let updateAvailable=false;const localRoute=new LocalApiPrintRoute({token:()=>apiToken,connection:()=>localConnection,journal:new JobJournal(database)});let selectedRoute:PrintRoute=localRoute;
  onMount(()=>{const update=()=>updateAvailable=true;window.addEventListener('mb-pwa-update',update);return()=>window.removeEventListener('mb-pwa-update',update)});
  let dialog='';
  async function restoreAutosave(){try{const recovered=await database.latestAutosave();if(recovered){editor.replace(recovered.document);status=`Recovered autosave from ${new Date(recovered.savedAt).toLocaleTimeString()}`;}}catch(error){status=`Autosave recovery unavailable: ${message(error)}`;}}
  async function restorePreferences(){const preferences=await database.getPreferences();if(preferences){editor.setView({gridSize:preferences.gridSize,showGrid:preferences.showGrid,showRulers:preferences.showRulers,snapping:preferences.snapping});printerId=preferences.defaultPrinterId??printerId;theme=preferences.theme;defaultRoute=preferences.defaultRoute??defaultRoute;applyTheme()}}
  function applyTheme(){if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme}function persistPreferences(){void database.savePreferences({gridSize:$editor.view.gridSize,showGrid:$editor.view.showGrid,showRulers:$editor.view.showRulers,snapping:$editor.view.snapping,defaultPrinterId:printerId||undefined,defaultRoute,theme})}
  void restoreAutosave();void restorePreferences();editor.subscribe(state=>{autosave(state.document);void database.savePreferences({gridSize:state.view.gridSize,showGrid:state.view.showGrid,showRulers:state.view.showRulers,snapping:state.view.snapping,defaultPrinterId:printerId||undefined,defaultRoute,theme});if(state.document.template)void database.saveTemplate(state.document.id,state.document.template);void database.saveRecent({id:state.document.id,kind:'document',openedAt:new Date().toISOString()})});
  async function open(event?:Event){try{const file=(event?.currentTarget as HTMLInputElement)?.files?.[0];const loaded=await ensureSdk();const opened=await openDocument(file,loaded);editor.replace(opened.document);handle=opened.handle;status=`Opened ${opened.document.title}`;}catch(error){status=message(error)}}
  async function save(){try{handle=await saveDocument($editor.document,undefined,handle as never);await database.saveDocument($editor.document);status='Saved';}catch(error){status=message(error)}}
  async function ensureSdk(){if(!sdk){status='Loading printer SDK…';sdk=await loadPrinterSdk();printers=await sdk.printerDefinitions();printerId||=printers[0]?.id??'';}return sdk}
  async function preview(){try{const loaded=await ensureSdk();const raster=await loaded.render($editor.document,{exactThermal:true});status=`Thermal preview: ${raster.width} × ${raster.height} dots`;}catch(error){status=message(error)}}
  async function exportFile(kind:'png'|'pdf'){try{const loaded=await ensureSdk();const data=kind==='png'?await loaded.exportPng($editor.document):await loaded.exportPdf([$editor.document]);const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([data.slice().buffer],{type:kind==='png'?'image/png':'application/pdf'}));link.download=`label.${kind}`;link.click();URL.revokeObjectURL(link.href);status=`Exported ${kind.toUpperCase()}.`}catch(error){status=message(error)}}
  async function print(){try{await ensureSdk();const printer=printers.find(item=>item.id===printerId);if(!printer)throw new Error('Select a printer model.');status='Printing…';const result=await localRoute.print({document:$editor.document,printer,copies:1,onProgress:value=>progress=value});status=result.outcome==='completed'?`Printed ${result.bytesSent} bytes`:`${result.outcome}: ${result.error??'Check the printer before retrying.'}`;}catch(error){status=message(error)}}
  function storeToken(){localStorage.setItem('mb-local-api-token',apiToken);status='Local service token stored only in this browser.'}
  function acceptToken(token:string){apiToken=token;storeToken()}
  function acceptConnection(connection:LocalApiConnection|undefined){localConnection=connection;connectionId=connection?.id??'';if(connection){localStorage.setItem('mb-local-api-connection',connection.id);selectedRoute=localRoute}else localStorage.removeItem('mb-local-api-connection');status=connection?`Selected ${connection.id} via ${connection.transport.kind}.`:'Select a persisted local printer connection.'}
  function acceptRoute(route:PrintRoute){selectedRoute=route;defaultRoute=route.id;persistPreferences()}
  async function retryRecovered(job:import('@makersbrain/label-editor').PersistedJob){if(job.route!=='local-api'){status='Reconnect through Direct browser print to start a new explicit hardware job; the interrupted job was not replayed.';return}const document=await database.get<import('@makersbrain/label-editor').LabelDocument>('documents',job.documentId);const printer=printers.find(item=>item.id===printerId);if(!document||!printer||!localConnection){status='Open the saved document and select its printer connection before explicitly retrying.';return}const result=await localRoute.print({document,printer,copies:1});status=`Explicit recovery attempt: ${result.outcome}.`}
  const message=(error:unknown)=>error instanceof Error?error.message:String(error);
</script>
<svelte:window on:online={()=>online=true} on:offline={()=>online=false}/>
<div class="app">
  <LabelEditor {editor} {sdk}>
    <BrandLockup slot="brand" product="Label Editor" href="./"/>
    <Menu slot="menu-start" label="File">
      <button on:click={()=>open()}>Open picker</button>
      <label class="file">Upload<input type="file" accept=".mb-label.json,application/json" on:change={open}></label>
      <button on:click={save}>Save</button>
      <hr>
      <button on:click={preview}>Thermal preview</button>
      <button on:click={()=>exportFile("png")}>Export PNG</button>
      <button on:click={()=>exportFile("pdf")}>Export PDF</button>
      <hr>
      <label>Theme<select bind:value={theme} on:change={()=>{applyTheme();persistPreferences()}}><option>system</option><option>light</option><option>dark</option></select></label>
      <label>Local API token<input class="token" type="password" bind:value={apiToken} on:change={storeToken} placeholder="Token" aria-label="Local service token"></label>
      {#if updateAvailable}<button on:click={()=>location.reload()}>Update application</button>{/if}
    </Menu>
    <Menu slot="menu-end" label="Print">
      <button on:click={()=>dialog='direct'}>Direct browser print…</button>
      <button on:click={()=>dialog='batch'}>Batch printing…</button>
      <button on:click={()=>dialog='laposte'}>La Poste sheets…</button>
      <hr>
      <button on:click={()=>dialog='service'}>Local service…</button>
      <button on:click={()=>dialog='jobs'}>Recover print jobs…</button>
    </Menu>
    <svelte:fragment slot="actions">
      <select bind:value={printerId} on:focus={()=>void ensureSdk()} aria-label="Printer model"><option value="">Printer model</option>{#each printers as printer}<option value={printer.id}>{printer.displayName}</option>{/each}</select>
      <button class="primary" on:click={print} disabled={!localConnection}>Print via service</button>
    </svelte:fragment>
  </LabelEditor>
  <footer aria-live="polite"><span class:offline={!online}>{online?'Online':'Offline — local editing and export remain available'}</span> · {status}{#if progress} · action {progress.action}/{progress.actions}, {progress.bytesSent}/{progress.totalBytes} bytes{/if}</footer>
  <Modal open={dialog==='service'} title="Local service" onClose={()=>dialog=''}><LocalServicePanel route={localRoute} onToken={acceptToken} onConnection={acceptConnection} selectedId={connectionId}/></Modal>
  <Modal open={dialog==='jobs'} title="Recover print jobs" onClose={()=>dialog=''}><JobRecoveryPanel {database} onRetry={retryRecovered}/></Modal>
  <Modal open={dialog==='direct'} title="Direct browser print" onClose={()=>dialog=''}>{#if sdk}<DirectPrintPanel document={$editor.document} {sdk} printer={printers.find(item=>item.id===printerId)} {database} onRoute={acceptRoute}/>{:else}<p class="pending">Select a printer model to load the printer SDK first.</p>{/if}</Modal>
  <Modal open={dialog==='batch'} title="Batch printing" onClose={()=>dialog=''}>{#if sdk}<BatchPanel document={$editor.document} {sdk} route={selectedRoute} printer={printers.find(item=>item.id===printerId)}/>{:else}<p class="pending">Select a printer model to load the printer SDK first.</p>{/if}</Modal>
  <Modal open={dialog==='laposte'} title="La Poste sheets" onClose={()=>dialog=''}>{#if sdk}<LaPostePanel {sdk} route={selectedRoute} printRequest={printers.find(item=>item.id===printerId)?{printer:printers.find(item=>item.id===printerId)!,copies:1}:undefined}/>{:else}<p class="pending">Select a printer model to load the printer SDK first.</p>{/if}</Modal>
</div>
<style>
  .app{height:100dvh;min-width:0;overflow:hidden;display:grid;grid-template-rows:minmax(0,1fr) auto}
  .app :global(.mb-lockup){white-space:nowrap}
  .file{display:flex;gap:.5rem;align-items:center;width:100%;padding:.3rem .45rem;border-radius:var(--mb-radius-sm);cursor:pointer}
  .file:hover{background:var(--mb-surface-2)}
  .file input[type=file]{position:absolute;opacity:0;width:1px}
  .token{width:8rem}
  .primary{background:var(--mb-accent);color:var(--mb-text-on-accent);border:1px solid var(--mb-accent);border-radius:var(--mb-radius-sm);padding:.28rem .55rem;white-space:nowrap;cursor:pointer}
  .primary:hover:not(:disabled){background:var(--mb-accent-hover);border-color:var(--mb-accent-hover)}
  .primary:disabled{opacity:.45;cursor:default}
  .pending{margin:0;padding:.9rem;color:var(--mb-text-muted);font-size:.8125rem}
  footer{padding:.35rem 1rem;background:var(--mb-bg);color:var(--mb-text-muted);border-top:var(--mb-border);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .offline{color:var(--mb-kiln-300)}
  @media(max-width:800px){.app :global(.appbar select){max-width:7.5rem}}
</style>
