<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import Panel from './Panel.svelte';
  import type { EditorStore } from '../store.svelte.js';
  import { evaluateTemplate } from '../template/evaluate.js';
  let { title = 'Template syntax', editor }: { title?: string; editor: EditorStore } = $props();
  /** Sample fields let the tester work before any CSV is loaded. */
  const sample: Record<string, string> = {
    name: 'Blueberry jam',
    price: '4.5',
    sku: 'bj-250',
    best_before: '2026-12-31',
    notes: '',
  };
  let expression = $state('{{price | number:2 | prefix:"EUR "}}');
  const template = $derived(editor.document.template);
  const record = $derived(template?.records[template.currentRecord] ?? sample);
  const fields = $derived(Object.keys(record));
  const result = $derived.by(() => {
    try {
      return { value: evaluateTemplate(expression, { record, locale: globalThis.navigator?.language }), error: '' };
    } catch (reason) {
      return { value: '', error: reason instanceof Error ? reason.message : String(reason) };
    }
  });
  const transforms: { syntax: string; effect: string; example: string }[] = [
    { syntax: 'upper', effect: 'Upper case', example: '{{sku | upper}}' },
    { syntax: 'lower', effect: 'Lower case', example: '{{name | lower}}' },
    { syntax: 'trim', effect: 'Removes surrounding whitespace', example: '{{name | trim}}' },
    {
      syntax: 'ascii',
      effect: 'Drops characters outside ASCII, for printers without accents',
      example: '{{name | ascii}}',
    },
    {
      syntax: 'default:"text"',
      effect: 'Text used when the field is empty or missing',
      example: '{{notes | default:"No notes"}}',
    },
    { syntax: 'prefix:"text"', effect: 'Adds text before the value', example: '{{price | prefix:"EUR "}}' },
    { syntax: 'suffix:"text"', effect: 'Adds text after the value', example: '{{price | suffix:" EUR"}}' },
    {
      syntax: 'number:2',
      effect: 'Fixed decimals with half-up rounding, at most 9. French locales get a comma',
      example: '{{price | number:2}}',
    },
    {
      syntax: 'date:%d/%m/%Y',
      effect: 'Reformats a YYYY-MM-DD date with %Y, %m, %d and %% tokens',
      example: '{{best_before | date:%d.%m.%Y}}',
    },
    {
      syntax: 'if-empty:yes:no',
      effect: 'Chooses a text by whether the value is empty',
      example: '{{notes | if-empty:plain:custom}}',
    },
    {
      syntax: 'if-eq:value:yes:no',
      effect: 'Chooses a text by comparing the value',
      example: '{{sku | if-eq:bj-250:jam:other}}',
    },
  ];
</script>

<Panel {title}>
  <p>
    Text, barcode, and QR values can contain expressions. Each expression names a data field and optional transforms
    separated by <code>|</code>, applied left to right. The preview on the canvas and the printer evaluate them the same
    way.
  </p>
  <p class="shape"><code>{'{{'}field | transform | transform{'}}'}</code></p>
  <h3>Fields</h3>
  <p>
    Any column of the loaded CSV, or <code>@date</code> for today. A missing field is an error unless
    <code>default:</code>
    or <code>if-empty:</code> follows it. Dates must be written <code>YYYY-MM-DD</code> in the data.
  </p>
  <h3>Transforms</h3>
  <table>
    <thead><tr><th>Transform</th><th>Effect</th><th>Example</th></tr></thead>
    <tbody
      >{#each transforms as item}<tr
          ><td><code>{item.syntax}</code></td><td>{item.effect}</td><td
            ><button type="button" class="example" title="Try this example" onclick={() => (expression = item.example)}
              ><code>{item.example}</code></button
            ></td
          ></tr
        >{/each}</tbody
    >
  </table>
  <h3>Try it</h3>
  <p class="muted">
    {template
      ? `Evaluated against record ${template.currentRecord + 1} of the loaded data.`
      : 'No data loaded; evaluated against sample fields.'} Fields: {fields.join(', ')}
  </p>
  <label>Expression<input type="text" bind:value={expression} spellcheck="false" /></label>
  <p class="output" aria-live="polite">
    {#if result.error}<span class="error">{result.error}</span>{:else}<output>{result.value}</output>{/if}
  </p>
</Panel>

<style>
  h3 {
    margin: 0.85rem 0 0.35rem;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  p {
    margin: 0.35rem 0;
  }
  code {
    font-family: var(--mble-font-mono);
    font-size: var(--mble-text-small);
  }
  .shape {
    padding: 0.4rem 0.6rem;
    background: var(--mble-background);
    border-radius: var(--mble-radius-sm);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-weight: 600;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
    padding: 0.2rem 0.3rem;
  }
  td {
    padding: 0.25rem 0.3rem;
    border-top: 1px solid var(--mble-border);
    vertical-align: top;
  }
  .example {
    padding: 0;
    background: none;
    border: 0;
    color: var(--mble-primary);
    cursor: pointer;
    text-align: left;
  }
  .example:hover {
    text-decoration: underline;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  input {
    font-family: var(--mble-font-mono);
  }
  .output {
    min-height: 1.4rem;
    padding: 0.4rem 0.6rem;
    background: var(--mble-background);
    border-radius: var(--mble-radius-sm);
    font-family: var(--mble-font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .muted {
    color: var(--mble-text-muted);
  }
  .error {
    color: var(--mble-danger);
  }
</style>
