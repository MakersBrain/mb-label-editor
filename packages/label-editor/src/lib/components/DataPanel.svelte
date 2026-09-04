<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">import{onMount}from'svelte';import type{EditorStore}from'../store.svelte.js';import{patchElement,updateDocument}from'../commands.js';import{parseCsv}from'../template/csv.js';import{evaluateTemplate}from'../template/evaluate.js';import{EditorDatabase}from'../persistence/database.js';import type{TemplateData}from'../model.js';import DataSheet from'./DataSheet.svelte';let { editor, onSyntaxHelp = () => {} }: { editor: EditorStore; onSyntaxHelp?: () => void } = $props();const database=new EditorDatabase();let error=$state('');let templates:{key:IDBValidKey,value:TemplateData}[]=$state.raw([]);onMount(refresh);async function refresh(){templates=await database.entries<TemplateData>('templates')}async function load(event:Event){try{const file=(event.currentTarget as HTMLInputElement).files?.[0];if(!file)return;const parsed=parseCsv(await file.text());const template={...parsed,currentRecord:0};editor.execute(updateDocument({template}));await database.saveTemplate(editor.document.id,template);await database.saveRecent({id:editor.document.id,kind:'template',openedAt:new Date().toISOString()});await refresh();error=''}catch(reason){error=reason instanceof Error?reason.message:String(reason)}}
async function persist(template:TemplateData){try{await database.saveTemplate(editor.document.id,template)}catch{/* persistence is best effort */}}
/** Rendering must never throw: a stale expression shows its error instead of taking the editor down. */
function resolved(source:string,record:Record<string,string>):string{try{return evaluateTemplate(source,{record})}catch(reason){return `⚠ ${reason instanceof Error?reason.message:String(reason)}`}}
function record(index:number){const template=editor.document.template;if(template)editor.execute(updateDocument({template:{...template,currentRecord:index}}))}
function map(element:import('../model.js').TextElement|import('../model.js').BarcodeElement|import('../model.js').QrElement,field:string,transform=''){if(field){const value=`{{${field}${transform?`|${transform}`:''}}}`;editor.execute(patchElement(element.id,element.type==='text'?{text:value}:{value}))}}
</script>
<section class="data">
  <h2>Data</h2>
  <p class="help">Each record fills the label once. Values such as <code>{'{{'}price | number:2{'}}'}</code> are evaluated per record. <button type="button" class="link" onclick={onSyntaxHelp}>Template syntax reference</button></p>
  <div class="sources">
    <label class="upload">Import CSV<input type="file" accept=".csv,text/csv" onchange={load}></label>
    {#if templates.length}<label class="saved">Saved data<select onchange={e=>{const item=templates[+e.currentTarget.value];if(item)editor.execute(updateDocument({template:structuredClone(item.value)}))}}><option value="">Choose saved data</option>{#each templates as item,index}<option value={index}>{String(item.key)} · {item.value.records.length} records</option>{/each}</select></label>{/if}
    <button type="button" class="connect" disabled title="Database connections are not available yet">Connect database…</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if editor.document.template}
    {@const template=editor.document.template}
    <DataSheet {editor} onChange={persist}/>
    <details open class="section"><summary>Preview record</summary>
      <label>Record <input type="range" min="0" max={Math.max(0,template.records.length-1)} value={template.currentRecord} oninput={(e)=>record(+e.currentTarget.value)}> <span class="muted">{template.currentRecord+1} of {template.records.length}</span></label>
      <dl>{#each template.fields as field}<dt>{field}</dt><dd>{template.records[template.currentRecord]?.[field]??''}</dd>{/each}</dl>
    </details>
    <details class="section"><summary>Field mapping</summary>
      {#each editor.document.elements.filter(e=>e.type==='text'||e.type==='barcode'||e.type==='qr') as element}<div class="mapping"><label>{element.name}<select class="field"><option value="">Choose CSV field</option>{#each template.fields as field}<option value={field}>{field}</option>{/each}</select></label><label>Transform<select onchange={e=>map(element,(e.currentTarget.closest('.mapping')?.querySelector('.field') as HTMLSelectElement)?.value,e.currentTarget.value)}><option value="">None</option><option>upper</option><option>lower</option><option>trim</option><option>ascii</option><option value="number:2">number (2 decimals)</option><option value="date:%Y-%m-%d">date YYYY-MM-DD</option></select></label></div>{:else}<p class="muted">Add a text, barcode, or QR element to map fields onto it.</p>{/each}
      <h3>Resolved elements</h3><ul>{#each editor.document.elements.filter(e=>e.type==='text'||e.type==='barcode'||e.type==='qr') as element}<li>{element.name}: {resolved(element.type==='text'?element.text:element.value,template.records[template.currentRecord]??{})}</li>{/each}</ul>
    </details>
  {:else}
    <p class="muted empty">No data yet. Import a CSV to get an editable sheet of records; each row becomes one label.</p>
  {/if}
</section>
<style>section{padding:.7rem .75rem;border-top:1px solid var(--mble-border,#e5dfd5)}.sources{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;margin-bottom:.6rem}.saved{display:flex;gap:.3rem;align-items:center;font-size:.72rem}.connect{font-size:.72rem}.section{margin-top:.6rem;border-top:1px solid var(--mble-border,#e5dfd5);padding-top:.4rem}.section summary{cursor:pointer;color:var(--mble-text-muted,#59635e);font-size:.72rem;font-weight:600}.section h3{margin:.6rem 0 .3rem;font-size:.72rem}.muted{color:var(--mble-text-muted,#59635e);font-size:.72rem}.empty{margin:.4rem 0}h2{margin:0 0 .5rem;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}.upload{display:inline-block;border:1px solid var(--mble-border-strong,#bbb);padding:.35rem;border-radius:var(--mble-radius-sm,4px)}.upload input{position:absolute;opacity:0;width:1px}dl,.mapping{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));font-size:.75rem;gap:.3rem}dt,dd{margin:0;padding:.15rem}.error{color:var(--mble-danger,#a21)}.help{margin:0 0 .5rem;font-size:.75rem;color:var(--mble-text-muted,#59635e)}.help code{font-family:var(--mble-font-mono,ui-monospace,monospace)}.link{padding:0;background:none;border:0;color:var(--mble-primary,#ed6146);cursor:pointer;font-size:inherit}.link:hover{text-decoration:underline}</style>
