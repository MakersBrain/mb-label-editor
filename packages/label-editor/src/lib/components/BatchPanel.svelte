<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { downloadBytes } from '../browser-files.js';
  import type { DocumentMaterializer, ZoneBatchPlacement } from '../materialization.js';
  import type { LabelDocument } from '../model.js';
  import { executeBatch } from '../print/batch.js';
  import type { PrinterDefinition, PrinterSdk, PrintRoute } from '../print/types.js';
  export let document: LabelDocument; export let sdk: PrinterSdk; export let materializer: DocumentMaterializer;
  export let route: PrintRoute | undefined = undefined; export let printer: PrinterDefinition | undefined = undefined;
  let copies=1;let zone='all';let status='';let busy=false;let controller:AbortController|undefined;let placements:ZoneBatchPlacement[]=[];let planVersion=0;
  $: zones=zone==='all'?(document.media.zones??[]):(document.media.zones??[]).filter(item=>item.id===zone);
  $: planKey=`${document.id}:${document.modifiedAt}:${document.template?.records.length??0}:${zones.map(item=>item.id).join(',')}`;
  $: void refreshPlan(planKey);
  async function refreshPlan(key:string){const version=++planVersion;if(!zones.length||!document.template?.records.length){placements=[];return}try{const plan=await materializer.planZoneBatch(document,{recordCount:document.template.records.length,zoneIds:zones.map(item=>item.id)});if(version===planVersion&&key===planKey)placements=plan.placements}catch(error){if(version===planVersion){placements=[];status=message(error)}}}
  async function documents(){const records=document.template?.records??[];if(!records.length)throw new Error('Import CSV records first.');return zones.length?materializer.materializeZoneBatch(document,records,{zoneIds:zones.map(item=>item.id)}):Promise.all(records.map(record=>materializer.materializeRecord(document,record)))}
  async function pdf(){if(busy)return;busy=true;try{const docs=await documents();const data=await sdk.exportPdf(docs.flatMap(doc=>Array.from({length:copies},()=>doc)));downloadBytes(data,{filename:'label-batch.pdf',mimeType:'application/pdf'});status=`Exported ${docs.length*copies} labels.`}catch(error){status=message(error)}finally{busy=false}}
  async function print(){if(!route||!printer||busy)return;busy=true;controller=new AbortController();try{const docs=await documents();const batch=await executeBatch({documents:docs,route,printer,copies,signal:controller.signal,onProgress:value=>status=`Printing ${value.item+1}/${value.items}: ${value.current.phase}`});status=batch.result.outcome==='completed'?`Printed ${batch.completed} records.`:`Stopped after ${batch.completed}: ${batch.result.outcome}. Inspect printer before retrying.`}catch(error){status=message(error)}finally{busy=false;controller=undefined}}
  const message=(error:unknown)=>error instanceof Error?error.message:String(error);
</script>
<section><h2>Batch</h2><p>{document.template?.records.length??0} records</p><label>Batch zone layout<select bind:value={zone} disabled={busy}><option value="all">Fill all zones by page</option>{#each document.media.zones??[] as item}<option value={item.id}>Only {item.name}</option>{/each}</select></label>{#if placements.length}<p class="placements">{placements.slice(0,8).map(item=>`#${item.record+1}→page ${item.page+1}/${item.zone}`).join(' · ')}</p>{:else if document.template?.records.length}<p>Add a media zone to define batch placement.</p>{/if}<label>Copies per record<input type="number" min="1" max="100" bind:value={copies} disabled={busy}></label><button on:click={pdf} disabled={busy}>Export batch PDF</button><button on:click={print} disabled={busy||!route||!printer||!document.template?.records.length}>Print batch</button>{#if busy&&controller}<button on:click={()=>controller?.abort()}>Stop batch</button>{/if}<p aria-live="polite">{status}</p></section>
<style>section{padding:.7rem .75rem;border-top:1px solid var(--mble-border,#e5dfd5)}h2{margin:0 0 .5rem;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}label{display:flex;flex-direction:column;font-size:.75rem}.placements{font-size:.7rem}</style>
