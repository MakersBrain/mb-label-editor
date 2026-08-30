<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import type { EditorStore } from '../store.js';
  import type { MediaPreset, PrinterDefinition, PrinterSdk } from '../print/types.js';
  import { updateDocument } from '../commands.js';
  import { uuid, type Media } from '../model.js';

  export let editor: EditorStore;
  export let sdk: PrinterSdk | undefined = undefined;
  export let printers: PrinterDefinition[] = [];
  export let printerId = '';
  export let onPrinter: (id: string) => void = () => {};

  const presets = [['50 × 30', 50, 30, 203, 'rectangle'], ['La Poste', 63.5, 33.9, 300, 'rectangle'], ['Round 50', 50, 50, 203, 'round']] as const;
  let stock: MediaPreset[] = [];
  let loadedFor = '';
  $: if (sdk && printerId && printerId !== loadedFor) { loadedFor = printerId; void loadStock(printerId); }
  $: selectedStock = stock.find(item => Math.abs(item.widthMm - $editor.document.media.width) < .01 && (item.shape === 'continuous' || Math.abs(item.heightMm - $editor.document.media.height) < .01))?.id ?? '';

  function media(patch: Partial<Media>) {
    const next = { ...$editor.document.media, ...patch };
    if (patch.width || patch.height) next.printableBounds = { x: 0, y: 0, width: next.width, height: next.height };
    editor.execute(updateDocument({ media: next }));
  }
  function preset(index: string) { const value = presets[+index]; if (value) media({ width: value[1], height: value[2], dpi: value[3], shape: value[4] }); }
  function stockPreset(id: string) { const item = stock.find(entry => entry.id === id); if (item) media({ width: item.widthMm, height: item.heightMm || $editor.document.media.height, shape: item.shape === 'round' ? 'round' : item.shape === 'continuous' ? 'continuous' : 'rectangle' }); }
  async function loadStock(id: string) {
    const printer = printers.find(item => item.id === id);
    stock = printer && sdk?.mediaPresets ? await sdk.mediaPresets(printer) : [];
    if (printer) media({ width: Math.min(printer.media.maxWidth, Math.max(printer.media.minWidth, $editor.document.media.width)), height: Math.min(printer.media.maxHeight, Math.max(printer.media.minHeight, $editor.document.media.height)), dpi: printer.dpi });
  }
  function addZone(clone = false) { const zones = $editor.document.media.zones ?? []; const source = zones[0]; media({ zones: [...zones, { id: uuid(), name: `Zone ${zones.length + 1}`, x: source?.x ?? 0, y: source?.y ?? 0, width: source?.width ?? $editor.document.media.width, height: source?.height ?? $editor.document.media.height, ...clone && source ? { cloneOf: source.id } : {} }] }); }
  function edit(id: string, patch: Record<string, unknown>) { media({ zones: ($editor.document.media.zones ?? []).map(zone => zone.id === id ? { ...zone, ...patch } : zone) }); }
  function remove(id: string) { media({ zones: ($editor.document.media.zones ?? []).filter(zone => zone.id !== id).map(zone => zone.cloneOf === id ? { ...zone, cloneOf: undefined } : zone) }); }
</script>

{#if printers.length}<section class="capabilities">
  <label>Printer<select value={printerId} on:change={event => onPrinter(event.currentTarget.value)}><option value="">Choose printer</option>{#each printers as printer}<option value={printer.id}>{printer.displayName} · {printer.dpi} dpi</option>{/each}</select></label>
  {#if stock.length}<label>Media for this printer<select value={selectedStock} on:change={event => stockPreset(event.currentTarget.value)}><option value="">Custom size</option>{#each stock as item}<option value={item.id}>{item.name} · {item.widthMm} × {item.heightMm || 'continuous'} mm</option>{/each}</select></label><p class="hint">Selecting stock sets the exact label size and media type used for preview and printing.</p>{/if}
</section>{/if}
<section><h2>Media & zones</h2><label>Generic preset<select on:change={event => preset(event.currentTarget.value)}><option value="">Custom</option>{#each presets as item, index}<option value={index}>{item[0]}</option>{/each}</select></label><div class="grid">{#each ['width', 'height', 'dpi'] as key}<label>{key}<input type="number" min="1" step=".1" value={$editor.document.media[key as 'width']} on:change={event => media({ [key]: +event.currentTarget.value })}></label>{/each}<label>Shape<select value={$editor.document.media.shape} on:change={event => media({ shape: event.currentTarget.value as Media['shape'] })}><option>rectangle</option><option>round</option><option>continuous</option></select></label></div><button on:click={() => addZone()}>Add independent zone</button><button on:click={() => addZone(true)} disabled={!$editor.document.media.zones?.length}>Add cloned zone</button>{#each $editor.document.media.zones ?? [] as zone}<fieldset><legend>{zone.name}</legend><div class="grid"><label>Name<input value={zone.name} on:change={event => edit(zone.id, { name: event.currentTarget.value })}></label>{#each ['x', 'y', 'width', 'height'] as key}<label>{key}<input type="number" step=".1" value={zone[key as 'x']} on:change={event => edit(zone.id, { [key]: +event.currentTarget.value })}></label>{/each}<label>Mode<select value={zone.cloneOf ?? ''} on:change={event => edit(zone.id, { cloneOf: event.currentTarget.value || undefined })}><option value="">Independent</option>{#each ($editor.document.media.zones ?? []).filter(item => item.id !== zone.id) as source}<option value={source.id}>Clone {source.name}</option>{/each}</select></label></div><button on:click={() => remove(zone.id)}>Remove</button></fieldset>{/each}</section>
<style>section{padding:.7rem .75rem;border-top:1px solid var(--mble-border,#e5dfd5)}h2{margin:0 0 .5rem;color:var(--mble-text-muted,#59635e);font-size:.75rem;font-weight:600}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem}label{display:flex;flex-direction:column;font-size:.75rem}.hint{margin:.4rem 0 0;color:var(--mble-text-muted,#59635e);font-size:.72rem}fieldset{margin:.5rem 0}</style>
