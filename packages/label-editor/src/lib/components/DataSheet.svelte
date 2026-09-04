<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.svelte.js';
  import { updateDocument } from '../commands.js';
  import type { TemplateData } from '../model.js';
  export let editor: EditorStore;
  /** Called after every committed change so the host can persist the template. */
  export let onChange: (template: TemplateData) => void = () => {};
  let newField = '';
  $: template = $editor.document.template;
  function commit(next: TemplateData, coalesceKey?: string) { editor.execute(updateDocument({ template: next }, coalesceKey)); onChange(next); }
  function setCell(row: number, field: string, value: string) {
    if (!template) return; const record = template.records[row];
    if (!record || (record[field] ?? '') === value) return;
    commit({ ...template, records: template.records.map((item, index) => index === row ? { ...item, [field]: value } : item) }, `cell:${row}:${field}`);
  }
  function selectRow(row: number) { if (template && template.currentRecord !== row) commit({ ...template, currentRecord: row }); }
  function addRow() {
    if (!template) return;
    const blank = Object.fromEntries(template.fields.map(field => [field, '']));
    commit({ ...template, records: [...template.records, blank], currentRecord: template.records.length });
  }
  function duplicateRow(row: number) {
    if (!template) return; const source = template.records[row]; if (!source) return;
    const records = [...template.records]; records.splice(row + 1, 0, { ...source });
    commit({ ...template, records, currentRecord: row + 1 });
  }
  function deleteRow(row: number) {
    if (!template) return;
    const records = template.records.filter((_, index) => index !== row);
    commit({ ...template, records, currentRecord: Math.max(0, Math.min(template.currentRecord, records.length - 1)) });
  }
  function addField() {
    const name = newField.trim();
    if (!template || !name || template.fields.includes(name)) return;
    commit({ ...template, fields: [...template.fields, name], records: template.records.map(record => ({ ...record, [name]: '' })) });
    newField = '';
  }
  function removeField(field: string) {
    if (!template || template.fields.length <= 1) return;
    commit({ ...template, fields: template.fields.filter(item => item !== field), records: template.records.map(record => { const copy = { ...record }; delete copy[field]; return copy; }) });
  }
  /** Enter moves down a row like a spreadsheet; the change itself commits on blur. */
  function cellKeys(event: KeyboardEvent, row: number, column: number) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const input = event.currentTarget as HTMLInputElement; input.blur();
    const next = input.closest('table')?.querySelector<HTMLInputElement>(`input[data-row="${row + 1}"][data-column="${column}"]`);
    next?.focus();
  }
  const quote = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  function exportCsv() {
    if (!template) return;
    const lines = [template.fields.map(quote).join(','), ...template.records.map(record => template.fields.map(field => quote(record[field] ?? '')).join(','))];
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }));
    anchor.download = `${$editor.document.title || 'records'}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href);
  }
</script>
{#if template}
  <div class="sheet-wrap">
    <table class="sheet" aria-label="Data records">
      <thead><tr><th class="num" scope="col">#</th>{#each template.fields as field (field)}<th scope="col"><span class="field">{field}</span>{#if template.fields.length > 1}<button type="button" class="remove" aria-label={`Remove column ${field}`} title="Remove column" on:click={() => removeField(field)}>×</button>{/if}</th>{/each}<th class="actions" scope="col"><span class="visually-hidden">Row actions</span></th></tr></thead>
      <tbody>
        {#each template.records as record, row (row)}
          <tr class:current={row === template.currentRecord}>
            <th class="num" scope="row"><button type="button" aria-label={`Preview record ${row + 1}`} aria-pressed={row === template.currentRecord} title="Preview this record on the label" on:click={() => selectRow(row)}>{row + 1}</button></th>
            {#each template.fields as field, column (field)}<td><input type="text" data-row={row} data-column={column} aria-label={`${field}, row ${row + 1}`} value={record[field] ?? ''} on:change={(event) => setCell(row, field, event.currentTarget.value)} on:focus={() => selectRow(row)} on:keydown={(event) => cellKeys(event, row, column)}></td>{/each}
            <td class="actions"><button type="button" aria-label={`Duplicate row ${row + 1}`} title="Duplicate row" on:click={() => duplicateRow(row)}>⧉</button><button type="button" aria-label={`Delete row ${row + 1}`} title="Delete row" on:click={() => deleteRow(row)}>×</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="sheet-tools">
    <button type="button" on:click={addRow}>Add row</button>
    <form class="add-field" on:submit|preventDefault={addField}><input type="text" placeholder="New column" aria-label="New column name" bind:value={newField}><button type="submit" disabled={!newField.trim() || template.fields.includes(newField.trim())}>Add column</button></form>
    <button type="button" on:click={exportCsv}>Export CSV</button>
    <span class="count">{template.records.length} {template.records.length === 1 ? 'record' : 'records'} · {template.fields.length} {template.fields.length === 1 ? 'column' : 'columns'}</span>
  </div>
{/if}
<style>
  .sheet-wrap{max-height:22rem;overflow:auto;border:1px solid var(--mble-border,#d8d0c3);border-radius:var(--mble-radius-sm,4px);background:var(--mble-surface,#fff)}
  .sheet{border-collapse:separate;border-spacing:0;min-width:100%;font-size:.75rem}
  th,td{padding:0;border-bottom:1px solid var(--mble-border,#e5dfd5);border-right:1px solid var(--mble-border,#e5dfd5);white-space:nowrap}
  thead th{position:sticky;top:0;z-index:1;padding:.3rem .4rem;background:var(--mble-background,#f7f4ed);color:var(--mble-text-muted,#59635e);font-weight:600;text-align:left}
  thead th .field{margin-right:.3rem}
  .remove{padding:0 .25rem;border:0;background:transparent;color:var(--mble-text-muted,#59635e);cursor:pointer;opacity:.5}
  .remove:hover{opacity:1;color:var(--mble-danger,#a21)}
  .num{position:sticky;left:0;z-index:1;width:2rem;background:var(--mble-background,#f7f4ed);text-align:center}
  .num button{width:100%;padding:.3rem .2rem;border:0;background:transparent;color:var(--mble-text-muted,#59635e);font-variant-numeric:tabular-nums;cursor:pointer}
  tr.current .num button{background:var(--mble-primary,#ed6146);color:#fff}
  tr.current td{background:color-mix(in srgb,var(--mble-selection,#f5c8b9) 35%,var(--mble-surface,#fff))}
  td input{width:100%;min-width:7rem;box-sizing:border-box;padding:.3rem .4rem;border:0;border-radius:0;background:transparent;color:inherit;font:inherit}
  td input:focus{outline:2px solid var(--mble-primary,#ed6146);outline-offset:-2px;background:var(--mble-surface,#fff)}
  .actions{width:3rem;text-align:center}
  .actions button{padding:.1rem .25rem;border:0;background:transparent;color:var(--mble-text-muted,#59635e);cursor:pointer}
  .actions button:hover{color:var(--mble-danger,#a21)}
  .sheet-tools{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;margin-top:.45rem;font-size:.72rem}
  .add-field{display:flex;gap:.25rem}
  .add-field input{width:8rem}
  .count{margin-left:auto;color:var(--mble-text-muted,#59635e)}
  .visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>
