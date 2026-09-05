<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.svelte.js';
  import { updateDocument } from '../commands.js';
  import type { DerivedField, TemplateData } from '../model.js';
  import { allFieldNames, resolveRecord, validateDerivedField } from '../template/derived.js';
  /** `onChange` is called after every committed change so the host can persist the template. */
  let { editor, onChange = () => {} }: { editor: EditorStore; onChange?: (template: TemplateData) => void } = $props();
  let newField = $state('');
  const template = $derived(editor.document.template);
  const derivedFields = $derived(template?.derived ?? []);
  /** Rows as the label sees them: raw data plus derivedFields columns, errors shown in the cell. */
  const resolvedRows = $derived(
    template ? template.records.map((record) => resolveRecord(template, record, { lenient: true })) : [],
  );
  /** The formula being written or edited; `replacing` names the derivedFields column being edited. */
  let formula = $state<{ name: string; expression: string; replacing?: string } | undefined>(undefined);
  let includeDerivedInCsv = $state(true);
  const formulaError = $derived(
    formula && template ? validateDerivedField(template, formula, formula.replacing) : undefined,
  );
  function saveFormula() {
    if (!template || !formula || formulaError) return;
    const field: DerivedField = { name: formula.name.trim(), expression: formula.expression };
    const others = derivedFields.filter((item) => item.name !== formula?.replacing);
    const index = derivedFields.findIndex((item) => item.name === formula?.replacing);
    const next = [...others];
    next.splice(index >= 0 ? index : next.length, 0, field);
    commit({ ...template, derived: next });
    formula = undefined;
  }
  function removeDerived(name: string) {
    if (!template) return;
    commit({ ...template, derived: derivedFields.filter((item) => item.name !== name) });
  }
  function commit(next: TemplateData, coalesceKey?: string) {
    editor.execute(updateDocument({ template: next }, coalesceKey));
    onChange(next);
  }
  function setCell(row: number, field: string, value: string) {
    if (!template) return;
    const record = template.records[row];
    if (!record || (record[field] ?? '') === value) return;
    commit(
      {
        ...template,
        records: template.records.map((item, index) => (index === row ? { ...item, [field]: value } : item)),
      },
      `cell:${row}:${field}`,
    );
  }
  function selectRow(row: number) {
    if (template && template.currentRecord !== row) commit({ ...template, currentRecord: row });
  }
  function addRow() {
    if (!template) return;
    const blank = Object.fromEntries(template.fields.map((field) => [field, '']));
    commit({ ...template, records: [...template.records, blank], currentRecord: template.records.length });
  }
  function duplicateRow(row: number) {
    if (!template) return;
    const source = template.records[row];
    if (!source) return;
    const records = [...template.records];
    records.splice(row + 1, 0, { ...source });
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
    commit({
      ...template,
      fields: [...template.fields, name],
      records: template.records.map((record) => ({ ...record, [name]: '' })),
    });
    newField = '';
  }
  function removeField(field: string) {
    if (!template || template.fields.length <= 1) return;
    commit({
      ...template,
      fields: template.fields.filter((item) => item !== field),
      records: template.records.map((record) => {
        const copy = { ...record };
        delete copy[field];
        return copy;
      }),
    });
  }
  /** Enter moves down a row like a spreadsheet; the change itself commits on blur. */
  function cellKeys(event: KeyboardEvent, row: number, column: number) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const input = event.currentTarget as HTMLInputElement;
    input.blur();
    const next = input
      .closest('table')
      ?.querySelector<HTMLInputElement>(`input[data-row="${row + 1}"][data-column="${column}"]`);
    next?.focus();
  }
  const quote = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  function exportCsv() {
    if (!template) return;
    const columns = includeDerivedInCsv ? allFieldNames(template) : template.fields;
    const rows = includeDerivedInCsv ? resolvedRows : template.records;
    const lines = [
      columns.map(quote).join(','),
      ...rows.map((record) => columns.map((field) => quote(record[field] ?? '')).join(',')),
    ];
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' }));
    anchor.download = `${editor.document.title || 'records'}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }
</script>

{#if template}
  <div class="sheet-wrap mb-table-wrap">
    <table class="sheet" aria-label="Data records">
      <thead
        ><tr
          ><th class="num" scope="col">#</th>{#each template.fields as field (field)}<th scope="col"
              ><span class="field">{field}</span>{#if template.fields.length > 1}<button
                  type="button"
                  class="remove"
                  aria-label={`Remove column ${field}`}
                  title="Remove column"
                  onclick={() => removeField(field)}>×</button
                >{/if}</th
            >{/each}{#each derivedFields as item (item.name)}<th scope="col" class="derived" title={item.expression}
              ><span class="field"><span class="fx" aria-hidden="true">ƒ</span>{item.name}</span><button
                type="button"
                class="remove"
                aria-label={`Edit formula ${item.name}`}
                title="Edit formula"
                onclick={() => (formula = { name: item.name, expression: item.expression, replacing: item.name })}
                >✎</button
              ><button
                type="button"
                class="remove"
                aria-label={`Remove derived column ${item.name}`}
                title="Remove derived column"
                onclick={() => removeDerived(item.name)}>×</button
              ></th
            >{/each}<th class="actions" scope="col"><span class="visually-hidden">Row actions</span></th></tr
        ></thead
      >
      <tbody>
        {#each template.records as record, row (row)}
          <tr class:current={row === template.currentRecord}>
            <th class="num" scope="row"
              ><button
                type="button"
                aria-label={`Preview record ${row + 1}`}
                aria-pressed={row === template.currentRecord}
                title="Preview this record on the label"
                onclick={() => selectRow(row)}>{row + 1}</button
              ></th
            >
            {#each template.fields as field, column (field)}<td
                ><input
                  type="text"
                  data-row={row}
                  data-column={column}
                  aria-label={`${field}, row ${row + 1}`}
                  value={record[field] ?? ''}
                  onchange={(event) => setCell(row, field, event.currentTarget.value)}
                  onfocus={() => selectRow(row)}
                  onkeydown={(event) => cellKeys(event, row, column)}
                /></td
              >{/each}{#each derivedFields as item (item.name)}<td
                class="derived"
                aria-label={`${item.name}, row ${row + 1}`}>{resolvedRows[row]?.[item.name] ?? ''}</td
              >{/each}
            <td class="actions"
              ><button
                type="button"
                aria-label={`Duplicate row ${row + 1}`}
                title="Duplicate row"
                onclick={() => duplicateRow(row)}>⧉</button
              ><button
                type="button"
                aria-label={`Delete row ${row + 1}`}
                title="Delete row"
                onclick={() => deleteRow(row)}>×</button
              ></td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="sheet-tools">
    <button type="button" onclick={addRow}>Add row</button>
    <form
      class="add-field"
      onsubmit={(event) => {
        event.preventDefault();
        addField();
      }}
    >
      <input type="text" placeholder="New column" aria-label="New column name" bind:value={newField} /><button
        type="submit"
        disabled={!newField.trim() || template.fields.includes(newField.trim())}>Add column</button
      >
    </form>
    <button type="button" onclick={() => (formula = { name: '', expression: '' })} disabled={!!formula}
      >Add derived column</button
    >
    <button type="button" onclick={exportCsv}>Export CSV</button>
    {#if derivedFields.length}<label class="csv-option"
        ><input type="checkbox" bind:checked={includeDerivedInCsv} /> Include derived columns</label
      >{/if}
    <span class="count" aria-live="polite"
      >{template.records.length}
      {template.records.length === 1 ? 'record' : 'records'} · {template.fields.length}
      {template.fields.length === 1 ? 'column' : 'columns'}{derivedFields.length
        ? ` · ${derivedFields.length} derivedFields`
        : ''}</span
    >
  </div>
  {#if formula}
    <form
      class="formula"
      aria-label="Derived column"
      onsubmit={(event) => {
        event.preventDefault();
        saveFormula();
      }}
    >
      <label>Column name<input type="text" bind:value={formula.name} placeholder="price_short" /></label>
      <label class="expression"
        >Formula<input
          type="text"
          bind:value={formula.expression}
          placeholder={'{{price | number:0}} €'}
          spellcheck="false"
        /></label
      >
      <button type="submit" class="primary" disabled={!!formulaError || !formula.name.trim()}
        >{formula.replacing ? 'Save formula' : 'Add column'}</button
      >
      <button type="button" onclick={() => (formula = undefined)}>Cancel</button>
      <p class="hint">
        {formulaError ??
          'Any {{field | transform}} expression; earlier derived columns can be used by later ones. The preview shows the current record.'}
      </p>
      {#if !formulaError && formula.expression && template.records[template.currentRecord]}
        {@const preview = resolveRecord(
          {
            ...template,
            derived: [
              ...derivedFields.filter((item) => item.name !== formula?.replacing),
              { name: '__preview', expression: formula.expression },
            ],
          },
          template.records[template.currentRecord],
          { lenient: true },
        ).__preview}
        <output class="preview">= {preview}</output>
      {/if}
    </form>
  {/if}
{/if}

<style>
  .sheet-wrap {
    max-height: 22rem;
    overflow: auto;
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-sm);
    background: var(--mble-surface);
  }
  .sheet {
    border-collapse: separate;
    border-spacing: 0;
    min-width: 100%;
    font-size: var(--mble-text-small);
  }
  th,
  td {
    padding: 0;
    border-bottom: 1px solid var(--mble-border);
    border-right: 1px solid var(--mble-border);
    white-space: nowrap;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: var(--mble-z-panel-sticky);
    padding: 0.3rem 0.4rem;
    background: var(--mble-background);
    color: var(--mble-text-muted);
    font-weight: 600;
    text-align: left;
  }
  thead th .field {
    margin-right: 0.3rem;
  }
  .remove {
    padding: 0 0.25rem;
    border: 0;
    background: transparent;
    color: var(--mble-text-muted);
    cursor: pointer;
    opacity: 0.5;
  }
  .remove:hover {
    opacity: 1;
    color: var(--mble-danger);
  }
  .num {
    position: sticky;
    left: 0;
    z-index: var(--mble-z-panel-sticky);
    width: 2rem;
    background: var(--mble-background);
    text-align: center;
  }
  .num button {
    width: 100%;
    padding: 0.3rem 0.2rem;
    border: 0;
    background: transparent;
    color: var(--mble-text-muted);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  tr.current .num button {
    background: var(--mble-primary);
    color: var(--mble-primary-text);
  }
  tr.current td {
    background: color-mix(in srgb, var(--mble-selection) 35%, var(--mble-surface));
  }
  td input {
    width: 100%;
    min-width: 7rem;
    box-sizing: border-box;
    padding: 0.3rem 0.4rem;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  td input:focus {
    outline: 2px solid var(--mble-primary);
    outline-offset: -2px;
    background: var(--mble-surface);
  }
  .actions {
    width: 3rem;
    text-align: center;
  }
  .actions button {
    padding: 0.1rem 0.25rem;
    border: 0;
    background: transparent;
    color: var(--mble-text-muted);
    cursor: pointer;
  }
  .actions button:hover {
    color: var(--mble-danger);
  }
  .sheet-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.45rem;
    font-size: var(--mble-text-small);
  }
  .add-field {
    display: flex;
    gap: 0.25rem;
  }
  .add-field input {
    width: 8rem;
  }
  th.derived,
  td.derived {
    background: var(--mble-surface-muted);
    color: var(--mble-text-muted);
  }
  td.derived {
    padding: 0.25rem 0.4rem;
    white-space: nowrap;
  }
  .fx {
    margin-right: 0.25rem;
    font-style: italic;
    color: var(--mble-primary);
  }
  .csv-option {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    font-size: var(--mble-text-micro);
  }
  .formula {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: end;
    margin-top: 0.5rem;
    padding: 0.5rem;
    border: 1px solid var(--mble-border);
    border-radius: var(--mble-radius-sm);
    background: var(--mble-surface-muted);
  }
  .formula label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: var(--mble-text-micro);
  }
  .formula .expression {
    flex: 1;
    min-width: 12rem;
  }
  .formula .expression input {
    font-family: var(--mble-font-mono);
  }
  .formula .hint,
  .formula .preview {
    flex-basis: 100%;
    margin: 0;
  }
  .formula .preview {
    font-family: var(--mble-font-mono);
    color: var(--mble-text);
  }
  .count {
    margin-left: auto;
    color: var(--mble-text-muted);
  }
</style>
