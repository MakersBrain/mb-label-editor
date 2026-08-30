<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import {onMount} from 'svelte';
  import {BrandLockup} from '@makersbrain/ui/svelte';
  import { AssetCatalogClient,BatchPanel,CloudPrintClient,CloudPrintPanel,CloudPrintRoute,DirectPrintPanel,JobRecoveryPanel,JobJournal,LabelEditor,LaPostePanel,LocalServicePanel,createEditorStore,defaultDocument,EditorDatabase,createAutosaver,openDocument,saveDocument,LocalApiPrintRoute,Modal,Menu,updateDocument,type CloudPrinter,type LocalApiConnection,type PrinterSdk,type PrinterDefinition,type PrintProgress,type PrintRoute } from '@makersbrain/label-editor'; import {loadPrinterSdk} from './sdk.js';
  const editor=createEditorStore(defaultDocument()); const database=new EditorDatabase(); const autosave=createAutosaver(database); let status='Ready'; let sdk:PrinterSdk|undefined;let printers:PrinterDefinition[]=[];let printerId='';let progress:PrintProgress|undefined;let apiToken=localStorage.getItem('mb-local-api-token')??'';let assetCatalogUrl=localStorage.getItem('mb-asset-catalog-url')??import.meta.env.VITE_ASSET_CATALOG_URL??'http://127.0.0.1:8766';let assetCatalogToken=localStorage.getItem('mb-asset-catalog-token')??'';let connectionId=localStorage.getItem('mb-local-api-connection')??'';let localConnection:LocalApiConnection|undefined;let cloudUrl=localStorage.getItem('mb-cloud-print-url')??'';let cloudTenant=localStorage.getItem('mb-cloud-print-tenant')??'';let cloudToken='';let cloudPrinterId=localStorage.getItem('mb-cloud-print-printer')??'';let cloudPrinter:CloudPrinter|undefined;let cloudClient:CloudPrintClient|undefined;let cloudRoute:CloudPrintRoute|undefined;let directRoute:PrintRoute|undefined;let handle:unknown;let online=navigator.onLine;let theme:'system'|'light'|'dark'='system';let defaultRoute='local-api';let updateAvailable=false;const localRoute=new LocalApiPrintRoute({token:()=>apiToken,connection:()=>localConnection,journal:new JobJournal(database)});let selectedRoute:PrintRoute=localRoute;
  let printing=false;
  $: assetCatalog=assetCatalogUrl.trim()?new AssetCatalogClient({baseUrl:assetCatalogUrl,token:()=>assetCatalogToken}):undefined;
  $: selectedPrinterDefinition=printers.find(item=>item.id===printerId);
  $: printAvailable=!!selectedPrinterDefinition&&(selectedRoute.id==='local-api'?!!localConnection&&localConnection.model===selectedPrinterDefinition.id:selectedRoute.id==='cloud-api'?!!cloudPrinter?.enabled&&cloudPrinter.model===selectedPrinterDefinition.id:!!directRoute);
  $: primaryPrintLabel=selectedRoute.id==='cloud-api'&&!cloudPrinter?.online?'Queue print':'Print';
  onMount(()=>{void ensureSdk();void restoreLocalConnection();const update=()=>updateAvailable=true;window.addEventListener('mb-pwa-update',update);return()=>window.removeEventListener('mb-pwa-update',update)});
  let dialog='';
  async function restoreAutosave(){try{const recovered=await database.latestAutosave();if(recovered){editor.replace(recovered.document);status=`Recovered autosave from ${new Date(recovered.savedAt).toLocaleTimeString()}`;}}catch(error){status=`Autosave recovery unavailable: ${message(error)}`;}}
  async function restorePreferences(){const preferences=await database.getPreferences();if(preferences){editor.setView({gridSize:preferences.gridSize,showGrid:preferences.showGrid,showRulers:preferences.showRulers,snapping:preferences.snapping});printerId=preferences.defaultPrinterId??printerId;theme=preferences.theme;defaultRoute=preferences.defaultRoute??defaultRoute;applyTheme()}}
  function applyTheme(){if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme}function persistPreferences(){void database.savePreferences({gridSize:$editor.view.gridSize,showGrid:$editor.view.showGrid,showRulers:$editor.view.showRulers,snapping:$editor.view.snapping,defaultPrinterId:printerId||undefined,defaultRoute,theme})}
  void restoreAutosave();void restorePreferences();editor.subscribe(state=>{autosave(state.document);void database.savePreferences({gridSize:state.view.gridSize,showGrid:state.view.showGrid,showRulers:state.view.showRulers,snapping:state.view.snapping,defaultPrinterId:printerId||undefined,defaultRoute,theme});if(state.document.template)void database.saveTemplate(state.document.id,state.document.template);void database.saveRecent({id:state.document.id,kind:'document',openedAt:new Date().toISOString()})});
  async function open(event?:Event){try{const file=(event?.currentTarget as HTMLInputElement)?.files?.[0];const loaded=await ensureSdk();const opened=await openDocument(file,loaded);editor.replace(opened.document);handle=opened.handle;status=`Opened ${opened.document.title}`;}catch(error){status=message(error)}}
  async function save(){try{handle=await saveDocument($editor.document,undefined,handle as never);await database.saveDocument($editor.document);status='Saved';}catch(error){status=message(error)}}
  async function ensureSdk(){if(!sdk){status='Loading printer SDK…';sdk=await loadPrinterSdk();printers=await sdk.printerDefinitions();printerId||=printers[0]?.id??'';}return sdk}
  async function restoreLocalConnection(){if(!apiToken||!connectionId)return;try{const connections=await localRoute.connections();const saved=connections.find(item=>item.id===connectionId);if(!saved){localStorage.removeItem('mb-local-api-connection');connectionId='';return}let restored=saved;try{const live=await localRoute.connectionStatus(saved.id);restored={...saved,status:live.status,media:live.media}}catch{/* retain the last persisted status while the printer is temporarily unavailable */}acceptConnection(restored,false)}catch(error){status=`Saved local printer unavailable: ${message(error)}`}}
  function selectPrinter(id:string){printerId=id;persistPreferences();status=id?`Selected ${printers.find(item=>item.id===id)?.displayName??id}. Connect it in the printer panel.`:'Select a printer model.'}
  async function preview(){try{const loaded=await ensureSdk();const raster=await loaded.render($editor.document,{exactThermal:true});status=`Thermal preview: ${raster.width} × ${raster.height} dots`;}catch(error){status=message(error)}}
  async function exportFile(kind:'png'|'pdf'){try{const loaded=await ensureSdk();const data=kind==='png'?await loaded.exportPng($editor.document):await loaded.exportPdf([$editor.document]);const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([data.slice().buffer],{type:kind==='png'?'image/png':'application/pdf'}));link.download=`label.${kind}`;link.click();URL.revokeObjectURL(link.href);status=`Exported ${kind.toUpperCase()}.`}catch(error){status=message(error)}}
  async function print(){if(printing)return;printing=true;try{await ensureSdk();const printer=printers.find(item=>item.id===printerId);if(!printer)throw new Error('Select a printer model.');status=selectedRoute.id==='cloud-api'&&!cloudPrinter?.online?'Queueing cloud print…':'Printing…';progress=undefined;const result=await selectedRoute.print({document:$editor.document,printer,copies:1,onProgress:value=>progress=value});status=result.outcome==='completed'?`Printed ${result.bytesSent} bytes`:`${result.outcome}: ${result.error??'Check the printer before retrying.'}`;}catch(error){status=message(error)}finally{printing=false}}
  function storeToken(){localStorage.setItem('mb-local-api-token',apiToken);status='Local service token stored only in this browser.'}
  function storeAssetCatalog(){const url=assetCatalogUrl.trim().replace(/\/+$/,'');assetCatalogUrl=url;if(url)localStorage.setItem('mb-asset-catalog-url',url);else localStorage.removeItem('mb-asset-catalog-url');if(assetCatalogToken)localStorage.setItem('mb-asset-catalog-token',assetCatalogToken);else localStorage.removeItem('mb-asset-catalog-token');status=url?'Asset catalogue settings stored only in this browser.':'Remote asset catalogue disabled.'}
  function acceptToken(token:string){apiToken=token;storeToken()}
  function acceptConnection(connection:LocalApiConnection|undefined,announce=true){localConnection=connection;connectionId=connection?.id??'';if(connection){localStorage.setItem('mb-local-api-connection',connection.id);printerId=connection.model;selectedRoute=localRoute;defaultRoute=localRoute.id;persistPreferences()}else localStorage.removeItem('mb-local-api-connection');if(announce)status=connection?`Selected ${connection.id} via ${connection.transport.kind}.`:'Select a persisted local printer connection.'}
  function acceptRoute(route:PrintRoute){directRoute=route;selectedRoute=route;defaultRoute=route.id;persistPreferences()}
  function chooseRoute(id:string){const route=id==='local-api'?localRoute:id==='cloud-api'?cloudRoute:directRoute;if(route){selectedRoute=route;defaultRoute=route.id;persistPreferences()}}
  async function connectCloud(){try{const baseUrl=cloudUrl.trim().replace(/\/+$/,'');const tenantId=cloudTenant.trim();if(!cloudToken.trim())throw new Error('Enter the print-only cloud token for this session.');const client=new CloudPrintClient({baseUrl,tenantId,getAccessToken:()=>cloudToken});await client.listPrinters();cloudUrl=baseUrl;cloudTenant=tenantId;cloudClient=client;cloudRoute=new CloudPrintRoute({client,printer:()=>cloudPrinter,journal:new JobJournal(database)});localStorage.setItem('mb-cloud-print-url',baseUrl);localStorage.setItem('mb-cloud-print-tenant',tenantId);selectedRoute=cloudRoute;defaultRoute=cloudRoute.id;persistPreferences();dialog='cloud';status='Cloud print session connected. The token will be forgotten when this page closes.'}catch(error){status=message(error)}}
  function endCloudSession(){cloudToken='';cloudClient=undefined;cloudRoute=undefined;cloudPrinter=undefined;if(selectedRoute.id==='cloud-api')selectedRoute=localRoute;status='Cloud print token cleared from this session.'}
  function acceptCloudPrinter(value:CloudPrinter|undefined){cloudPrinter=value;cloudPrinterId=value?.id??'';if(value){localStorage.setItem('mb-cloud-print-printer',value.id);printerId=value.model;selectedRoute=cloudRoute??selectedRoute;status=`Selected cloud printer ${value.displayName}${value.online?'':' (offline; current labels will queue)'}.`}else localStorage.removeItem('mb-cloud-print-printer')}
  async function retryRecovered(job:import('@makersbrain/label-editor').PersistedJob){if(job.route==='cloud-api'){if(!cloudRoute){dialog='cloud-connect';status='Reconnect the cloud session to resume this job.';return}const result=await cloudRoute.recover(job);status=`Cloud recovery: ${result.outcome}${result.error?`: ${result.error}`:''}.`;return}if(job.route!=='local-api'){status='Reconnect through Direct browser print to start a new explicit hardware job; the interrupted job was not replayed.';return}const document=await database.get<import('@makersbrain/label-editor').LabelDocument>('documents',job.documentId);const printer=printers.find(item=>item.id===printerId);if(!document||!printer||!localConnection){status='Open the saved document and select its printer connection before explicitly retrying.';return}const result=await localRoute.print({document,printer,copies:1});status=`Explicit recovery attempt: ${result.outcome}.`}
  function applyPrinterMedia(media:{width:number;height:number;shape:'rectangle'|'round'|'continuous'}){const next={...$editor.document.media,width:media.width,height:media.height,shape:media.shape,printableBounds:{x:0,y:0,width:media.width,height:media.height}};editor.execute(updateDocument({media:next}));status=`Label media set to ${media.width} × ${media.height} mm from the printer.`}
  const message=(error:unknown)=>error instanceof Error?error.message:String(error);
</script>
<svelte:window on:online={()=>online=true} on:offline={()=>online=false}/>
<div class="app">
  <LabelEditor {editor} {sdk} {assetCatalog} {printers} {printerId} onPrinter={selectPrinter}>
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
      <hr>
      <label>Asset catalogue URL<input class="service-url" type="url" bind:value={assetCatalogUrl} on:change={storeAssetCatalog} placeholder="http://127.0.0.1:8766"></label>
      <label>Asset catalogue token<input class="token" type="password" bind:value={assetCatalogToken} on:change={storeAssetCatalog} placeholder="Optional token"></label>
      {#if updateAvailable}<button on:click={()=>location.reload()}>Update application</button>{/if}
    </Menu>
    <Menu slot="menu-end" label="Print">
      <button on:click={print} disabled={printing||!printAvailable}>{primaryPrintLabel} current label via {selectedRoute.label}</button>
      <button on:click={()=>dialog='batch'}>Batch printing…</button>
      <button on:click={()=>dialog='laposte'}>La Poste sheets…</button>
      <hr>
      <button on:click={()=>dialog='service'}>Local service…</button>
      <button on:click={()=>dialog=cloudRoute?'cloud':'cloud-connect'}>Cloud printers…</button>
      {#if cloudRoute}<button on:click={endCloudSession}>End cloud session</button>{/if}
      <button on:click={()=>dialog='jobs'}>Recover print jobs…</button>
    </Menu>
    <svelte:fragment slot="actions">
      <span class="media-chip">{$editor.document.media.width} × {$editor.document.media.height} mm · {$editor.document.media.shape}</span>
      <select value={selectedRoute.id} on:change={event=>chooseRoute(event.currentTarget.value)} aria-label="Print route"><option value="local-api">Local service</option>{#if directRoute}<option value={directRoute.id}>Direct browser</option>{/if}{#if cloudRoute}<option value="cloud-api">Cloud</option>{/if}</select>
      <select value={printerId} on:change={event=>selectPrinter(event.currentTarget.value)} on:focus={()=>void ensureSdk()} aria-label="Printer model"><option value="">Printer model</option>{#each printers as printer}<option value={printer.id}>{printer.displayName}</option>{/each}</select>
      <button class="primary" on:click={print} disabled={printing||!printAvailable}>{primaryPrintLabel}</button>
    </svelte:fragment>
    <svelte:fragment slot="sidebar">{#if sdk}<DirectPrintPanel document={$editor.document} {sdk} printer={printers.find(item=>item.id===printerId)} {database} localRoute={localRoute} {localConnection} onLocalConnection={acceptConnection} onConfigureLocal={()=>dialog='service'} onSelectLocal={()=>chooseRoute('local-api')} onRoute={acceptRoute} onMedia={applyPrinterMedia}/>{:else}<p class="pending">Loading printer support…</p>{/if}</svelte:fragment>
  </LabelEditor>
  <footer aria-live="polite"><span class:offline={!online}>{online?'Online':'Offline — local editing and export remain available'}</span> · {status}{#if progress} · action {progress.action}/{progress.actions}, {progress.bytesSent}/{progress.totalBytes} bytes{/if}</footer>
  <Modal open={dialog==='service'} title="Local service" onClose={()=>dialog=''}><LocalServicePanel route={localRoute} onToken={acceptToken} onConnection={acceptConnection} selectedId={connectionId}/></Modal>
  <Modal open={dialog==='cloud-connect'} title="Connect cloud printing" onClose={()=>dialog=''}><section class="cloud-connect"><label>Cloud service URL<input type="url" bind:value={cloudUrl} placeholder="https://print.example.com"></label><label>Tenant ID<input bind:value={cloudTenant} spellcheck="false"></label><label>Print-only token<input type="password" bind:value={cloudToken} autocomplete="off"></label><button on:click={connectCloud} disabled={!cloudUrl.trim()||!cloudTenant.trim()||!cloudToken.trim()}>Connect for this session</button><p>The service URL and tenant are remembered. The token stays only in memory and is forgotten on reload.</p></section></Modal>
  <Modal open={dialog==='cloud'} title="Cloud printers" onClose={()=>dialog=''}>{#if cloudClient&&cloudRoute}<CloudPrintPanel client={cloudClient} route={cloudRoute} document={$editor.document} printer={printers.find(item=>item.id===printerId)} selectedId={cloudPrinterId} onPrinter={acceptCloudPrinter}/>{:else}<p class="pending">Connect a cloud print session first.</p>{/if}</Modal>
  <Modal open={dialog==='jobs'} title="Recover print jobs" onClose={()=>dialog=''}><JobRecoveryPanel {database} onRetry={retryRecovered}/></Modal>
  <Modal open={dialog==='batch'} title="Batch printing" onClose={()=>dialog=''}>{#if selectedRoute.id==='cloud-api'&&!cloudPrinter?.online}<p class="pending">Cloud batch printing requires the selected printer to be online. Queue only one current label while it is offline.</p>{/if}{#if sdk}<BatchPanel document={$editor.document} {sdk} route={selectedRoute.id==='cloud-api'&&!cloudPrinter?.online?undefined:selectedRoute} printer={printers.find(item=>item.id===printerId)}/>{:else}<p class="pending">Select a printer model to load the printer SDK first.</p>{/if}</Modal>
  <Modal open={dialog==='laposte'} title="La Poste sheets" onClose={()=>dialog=''}>{#if selectedRoute.id==='cloud-api'&&!cloudPrinter?.online}<p class="pending">Cloud La Poste printing requires the selected printer to be online. Queue only one current label while it is offline.</p>{/if}{#if sdk}<LaPostePanel {sdk} route={selectedRoute.id==='cloud-api'&&!cloudPrinter?.online?undefined:selectedRoute} printRequest={printers.find(item=>item.id===printerId)?{printer:printers.find(item=>item.id===printerId)!,copies:1}:undefined}/>{:else}<p class="pending">Select a printer model to load the printer SDK first.</p>{/if}</Modal>
</div>
<style>
  .app{height:100dvh;min-width:0;overflow:hidden;display:grid;grid-template-rows:minmax(0,1fr) auto}
  .app :global(.mb-lockup){white-space:nowrap}
  .file{display:flex;gap:.5rem;align-items:center;width:100%;padding:.3rem .45rem;border-radius:var(--mb-radius-sm);cursor:pointer}
  .file:hover{background:var(--mb-surface-2)}
  .file input[type=file]{position:absolute;opacity:0;width:1px}
  .token{width:8rem}
  .service-url{width:14rem}
  .primary{background:var(--mb-accent);color:var(--mb-text-on-accent);border:1px solid var(--mb-accent);border-radius:var(--mb-radius-sm);padding:.28rem .55rem;white-space:nowrap;cursor:pointer}
  .primary:hover:not(:disabled){background:var(--mb-accent-hover);border-color:var(--mb-accent-hover)}
  .primary:disabled{opacity:.45;cursor:default}
  .media-chip{padding:.22rem .45rem;border:var(--mb-border);border-radius:var(--mb-radius-sm);color:var(--mb-text-muted);font-size:.72rem;white-space:nowrap}
  .pending{margin:0;padding:.9rem;color:var(--mb-text-muted);font-size:.8125rem}
  .cloud-connect{display:flex;flex-direction:column;gap:.6rem;padding:.8rem}.cloud-connect label{display:flex;flex-direction:column;gap:.2rem;font-size:.75rem}.cloud-connect p{font-size:.75rem;color:var(--mb-text-muted)}
  footer{padding:.35rem 1rem;background:var(--mb-bg);color:var(--mb-text-muted);border-top:var(--mb-border);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .offline{color:var(--mb-kiln-300)}
  @media(max-width:800px){.app :global(.appbar select){max-width:7.5rem}}
</style>
