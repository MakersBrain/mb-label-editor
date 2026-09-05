<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import Panel from './Panel.svelte';
  import { onMount } from 'svelte';
  import type { EditorStore } from '../store.svelte.js';
  import { patchElement, updateDocument } from '../commands.js';
  import { parseCsv } from '../template/csv.js';
  import { evaluateTemplate } from '../template/evaluate.js';
  import { EditorDatabase } from '../persistence/database.js';
  import type { TemplateData } from '../model.js';
  import DataSheet from './DataSheet.svelte';
  import { SAMPLE_CSV, documentFields } from '../template/placeholders.js';
  import { allFieldNames, currentResolvedRecord } from '../template/derived.js';
  /** `docked` means the host shows the sheet beside the canvas, so the panel only offers to collapse it. */
  let {
    title = 'Data',
    editor,
    onSyntaxHelp = () => {},
    docked = false,
    onDock = () => {},
  }: {
    title?: string;
    editor: EditorStore;
    onSyntaxHelp?: () => void;
    docked?: boolean;
    onDock?: () => void;
  } = $props();
  const labelFields = $derived(documentFields(editor.document));
  /** The previewed record with derived columns filled in. */
  const shownRecord = $derived(currentResolvedRecord(editor.document.template) ?? {});
  const database = new EditorDatabase();
  let error = $state('');
  let templates: { key: IDBValidKey; value: TemplateData }[] = $state.raw([]);
  onMount(refresh);
  async function refresh() {
    templates = await database.entries<TemplateData>('templates');
  }
  async function apply(template: TemplateData) {
    try {
      editor.execute(updateDocument({ template }));
      await database.saveTemplate(editor.document.id, template);
      await database.saveRecent({ id: editor.document.id, kind: 'template', openedAt: new Date().toISOString() });
      await refresh();
      error = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  async function load(event: Event) {
    try {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (!file) return;
      await apply({ ...parseCsv(await file.text()), currentRecord: 0 });
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }
  /** One empty record per field the label already references, so the sheet starts with the right columns. */
  function startFromLabel() {
    const fields = labelFields;
    void apply({ fields, records: [Object.fromEntries(fields.map((field) => [field, '']))], currentRecord: 0 });
  }
  function loadSample() {
    void apply({ ...parseCsv(SAMPLE_CSV), currentRecord: 0 });
  }
  async function persist(template: TemplateData) {
    try {
      await database.saveTemplate(editor.document.id, template);
    } catch {
      /* persistence is best effort */
    }
  }
  /** Rendering must never throw: a stale expression shows its error instead of taking the editor down. */
  function resolved(source: string, record: Record<string, string>): string {
    try {
      return evaluateTemplate(source, { record });
    } catch (reason) {
      return `⚠ ${reason instanceof Error ? reason.message : String(reason)}`;
    }
  }
  function record(index: number) {
    const template = editor.document.template;
    if (template) editor.execute(updateDocument({ template: { ...template, currentRecord: index } }));
  }
  function map(
    element: import('../model.js').TextElement | import('../model.js').BarcodeElement | import('../model.js').QrElement,
    field: string,
    transform = '',
  ) {
    if (field) {
      const value = `{{${field}${transform ? `|${transform}` : ''}}}`;
      editor.execute(patchElement(element.id, element.type === 'text' ? { text: value } : { value }));
    }
  }
</script>

<Panel {title} class="data">
  <p class="help">
    Each record fills the label once. Values such as <code>{'{{'}price | number:2{'}}'}</code> are evaluated per record.
    <button type="button" class="link" onclick={onSyntaxHelp}>Template syntax reference</button>
  </p>
  <div class="sources">
    <label class="upload">Import CSV<input type="file" accept=".csv,text/csv" onchange={load} /></label>
    {#if templates.length}<label class="saved"
        >Saved data<select
          onchange={(e) => {
            const item = templates[+e.currentTarget.value];
            if (item) editor.execute(updateDocument({ template: structuredClone(item.value) }));
          }}
          ><option value="">Choose saved data</option>{#each templates as item, index}<option value={index}
              >{String(item.key)} · {item.value.records.length} records</option
            >{/each}</select
        ></label
      >{/if}
    <button type="button" class="connect" disabled title="Database connections are not available yet"
      >Connect database…</button
    >
  </div>
  {#if error}<p class="mb-notice bad" role="alert">{error}</p>{/if}
  {#if editor.document.template}
    {@const template = editor.document.template}
    <div class="sheet-tools">
      <button type="button" onclick={onDock}>{docked ? 'Collapse sheet' : 'Expand sheet'}</button>
      {#if docked}<span class="muted">The sheet is open beside the label.</span>{/if}
    </div>
    {#if !docked}<DataSheet {editor} onChange={persist} />{/if}
    <details open class="section">
      <summary>Preview record</summary>
      <label
        >Record <input
          type="range"
          min="0"
          max={Math.max(0, template.records.length - 1)}
          value={template.currentRecord}
          oninput={(e) => record(+e.currentTarget.value)}
        /> <span class="muted">{template.currentRecord + 1} of {template.records.length}</span></label
      >
      <dl class="mb-datalist">
        {#each allFieldNames(template) as field (field)}<dt>{field}</dt>
          <dd>{shownRecord[field] ?? ''}</dd>{/each}
      </dl>
    </details>
    <details class="section">
      <summary>Field mapping</summary>
      {#each editor.document.elements.filter((e) => e.type === 'text' || e.type === 'barcode' || e.type === 'qr') as element}<div
          class="mapping"
        >
          <label
            >{element.name}<select class="field"
              ><option value="">Choose CSV field</option>{#each allFieldNames(template) as field (field)}<option
                  value={field}>{field}</option
                >{/each}</select
            ></label
          ><label
            >Transform<select
              onchange={(e) =>
                map(
                  element,
                  (e.currentTarget.closest('.mapping')?.querySelector('.field') as HTMLSelectElement)?.value,
                  e.currentTarget.value,
                )}
              ><option value="">None</option><option>upper</option><option>lower</option><option>trim</option><option
                >ascii</option
              ><option value="number:2">number (2 decimals)</option><option value="date:%Y-%m-%d"
                >date YYYY-MM-DD</option
              ></select
            ></label
          >
        </div>{:else}<p class="muted">Add a text, barcode, or QR element to map fields onto it.</p>{/each}
      <h3>Resolved elements</h3>
      <ul>
        {#each editor.document.elements.filter((e) => e.type === 'text' || e.type === 'barcode' || e.type === 'qr') as element}<li
          >
            {element.name}: {resolved(
              element.type === 'text' ? element.text : element.value,
              currentResolvedRecord(template) ?? {},
            )}
          </li>{/each}
      </ul>
    </details>
  {:else}
    <p class="mb-empty">No data yet. Import a CSV to get an editable sheet of records; each row becomes one label.</p>
    <div class="starters">
      <button
        type="button"
        onclick={startFromLabel}
        disabled={!labelFields.length}
        title={labelFields.length
          ? `Columns: ${labelFields.join(', ')}`
          : 'Add a {{field}} expression to a text, barcode or QR element first'}>Start from this label's fields</button
      >
      <button type="button" onclick={loadSample}>Load sample CSV</button>
    </div>
  {/if}
</Panel>

<style>
  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-bottom: 0.6rem;
  }
  .saved {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    font-size: var(--mble-text-small);
  }
  .connect {
    font-size: var(--mble-text-small);
  }
  .section {
    margin-top: 0.6rem;
    border-top: 1px solid var(--mble-border);
    padding-top: 0.4rem;
  }
  .section summary {
    cursor: pointer;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-small);
    font-weight: 600;
  }
  .section h3 {
    margin: 0.6rem 0 0.3rem;
    font-size: var(--mble-text-small);
  }
  .muted {
    color: var(--mble-text-muted);
    font-size: var(--mble-text-small);
  }
  .starters,
  .sheet-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-bottom: 0.5rem;
    font-size: var(--mble-text-small);
  }
  .upload {
    display: inline-block;
    border: 1px solid var(--mble-border-strong);
    padding: 0.35rem;
    border-radius: var(--mble-radius-sm);
  }
  .upload input {
    position: absolute;
    opacity: 0;
    width: 1px;
  }
  .mapping {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    font-size: var(--mble-text-small);
    gap: 0.3rem;
  }
  .help {
    margin: 0 0 0.5rem;
    font-size: var(--mble-text-small);
    color: var(--mble-text-muted);
  }
  .help code {
    font-family: var(--mble-font-mono);
  }
  .link {
    padding: 0;
    background: none;
    border: 0;
    color: var(--mble-primary);
    cursor: pointer;
    font-size: inherit;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
