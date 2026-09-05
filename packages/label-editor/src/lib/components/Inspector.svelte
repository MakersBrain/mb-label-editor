<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import Panel from './Panel.svelte';
  import type { EditorStore } from '../store.svelte.js';
  import { patchElement } from '../commands.js';
  import type { ExternalResourceProvider } from '../external-resources/types.js';
  import {
    FONT_GROUPS,
    applyFamily,
    applyFont,
    embedLocalFont,
    embedProviderFont,
    embeddedFont,
    genericFor,
    pickFace,
    queryLocalFontFamilies,
    supportsLocalFonts,
    type LocalFontData,
  } from '../fonts.js';
  /** `title` is the panel heading; pass undefined when the host already names the panel. */
  let {
    editor,
    title = 'Inspector',
    resourceProvider,
  }: { editor: EditorStore; title?: string; resourceProvider?: ExternalResourceProvider } = $props();
  const number = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const patch = (id: string, value: Record<string, unknown>) => editor.execute(patchElement(id, value));
  /** Installed fonts by family once the person has granted access; undefined until then. */
  let localFonts = $state.raw<Map<string, LocalFontData[]> | undefined>(undefined);
  let fontStatus = $state('');
  let fontBusy = $state(false);
  async function loadLocalFonts() {
    try {
      fontStatus = 'Reading installed fonts…';
      localFonts = await queryLocalFontFamilies();
      fontStatus = localFonts.size
        ? `${localFonts.size} installed font families available.`
        : 'No installed fonts were shared.';
    } catch (error) {
      fontStatus = error instanceof Error ? error.message : String(error);
    }
  }
  /**
   * The select value is a font resource id, a curated `family:Name`, or an installed `local:Family`.
   * Embedding wins over naming: a face whose bytes travel with the label prints the same everywhere.
   */
  async function chooseFont(id: string, value: string) {
    if (value === 'sans-serif') {
      patch(id, { fontResourceId: undefined, fontFamily: 'sans-serif', fontWeight: 400 });
      fontStatus = '';
      return;
    }
    const existing = editor.document.fonts.find((item) => item.id === value);
    if (existing) {
      applyFont(editor, id, existing);
      fontStatus = '';
      return;
    }
    const family = value.replace(/^(family|local):/, '');
    const already = embeddedFont(editor, family);
    if (already) {
      applyFont(editor, id, already);
      fontStatus = `${family} is embedded in this label.`;
      return;
    }
    fontBusy = true;
    try {
      const installed = (localFonts ?? (value.startsWith('local:') ? await queryLocalFontFamilies() : undefined))?.get(
        family,
      );
      if (installed?.length) {
        fontStatus = `Embedding ${family} from this device…`;
        applyFont(editor, id, await embedLocalFont(editor, pickFace(installed)));
        fontStatus = `${family} embedded from this device; it prints exactly.`;
        return;
      }
      if (resourceProvider) {
        fontStatus = `Looking for ${family} in ${resourceProvider.displayName}…`;
        const font = await embedProviderFont(editor, resourceProvider, family);
        if (font) {
          applyFont(editor, id, font);
          fontStatus = `${family} embedded from ${resourceProvider.displayName}; it prints exactly.`;
          return;
        }
      }
      applyFamily(editor, id, family);
      fontStatus = `${family} is not embedded: the canvas uses it if installed here, the printer uses its default ${genericFor(family)} face.${supportsLocalFonts() && !localFonts ? ' Load system fonts to embed an installed copy.' : ''}`;
    } catch (error) {
      fontStatus = error instanceof Error ? error.message : String(error);
    } finally {
      fontBusy = false;
    }
  }
  /** What the select shows for the element: its embedded face, or its named family. */
  const fontValue = (element: { fontResourceId?: string; fontFamily: string }) =>
    element.fontResourceId ??
    (element.fontFamily === 'sans-serif'
      ? 'sans-serif'
      : localFonts?.has(element.fontFamily) &&
          !FONT_GROUPS.some((group) => group.families.some((f) => f.name === element.fontFamily))
        ? `local:${element.fontFamily}`
        : `family:${element.fontFamily}`);
</script>

<Panel {title} id="inspector">
  {#if editor.selectedElements.length === 1}{#each editor.selectedElements as element}
      <label
        >Name <input value={element.name} onchange={(e) => patch(element.id, { name: e.currentTarget.value })} /></label
      >
      <div class="grid">
        <label
          >X (mm)<input
            type="number"
            step=".1"
            value={element.transform.x}
            onchange={(e) =>
              patch(element.id, { transform: { ...element.transform, x: number(e.currentTarget.value) } })}
          /></label
        >
        <label
          >Y (mm)<input
            type="number"
            step=".1"
            value={element.transform.y}
            onchange={(e) =>
              patch(element.id, { transform: { ...element.transform, y: number(e.currentTarget.value) } })}
          /></label
        >
        <label
          >Width<input
            type="number"
            min=".1"
            step=".1"
            value={element.transform.width}
            onchange={(e) =>
              patch(element.id, { transform: { ...element.transform, width: number(e.currentTarget.value) } })}
          /></label
        >
        <label
          >Height<input
            type="number"
            min=".1"
            step=".1"
            value={element.transform.height}
            onchange={(e) =>
              patch(element.id, { transform: { ...element.transform, height: number(e.currentTarget.value) } })}
          /></label
        >
        <label
          >Rotation<input
            type="number"
            step="1"
            value={element.transform.rotation}
            onchange={(e) =>
              patch(element.id, { transform: { ...element.transform, rotation: number(e.currentTarget.value) } })}
          /></label
        >
        <label
          >Layer<input
            type="number"
            step="1"
            value={element.zIndex}
            onchange={(e) => patch(element.id, { zIndex: number(e.currentTarget.value) })}
          /></label
        >
      </div>
      {#if element.type === 'text'}
        <label
          >Text<textarea value={element.text} onchange={(e) => patch(element.id, { text: e.currentTarget.value })}
          ></textarea></label
        >
        <div class="grid">
          <label
            >Font<select
              value={fontValue(element)}
              disabled={fontBusy}
              onchange={(e) => void chooseFont(element.id, e.currentTarget.value)}
              ><option value="sans-serif">System sans</option>{#if editor.document.fonts.length}<optgroup
                  label="In this label"
                  >{#each editor.document.fonts as font (font.id)}<option value={font.id}
                      >{font.family} {font.weight}</option
                    >{/each}</optgroup
                >{/if}{#each FONT_GROUPS as group (group.label)}<optgroup label={group.label}
                  >{#each group.families as choice (choice.name)}<option value={`family:${choice.name}`}
                      >{choice.name}</option
                    >{/each}</optgroup
                >{/each}{#if localFonts?.size}<optgroup label="System fonts"
                  >{#each [...localFonts.keys()] as family (family)}<option value={`local:${family}`}>{family}</option
                    >{/each}</optgroup
                >{/if}{#if element.fontFamily !== 'sans-serif' && !element.fontResourceId && !FONT_GROUPS.some( (g) => g.families.some((f) => f.name === element.fontFamily) ) && !localFonts?.has(element.fontFamily)}<option
                  value={`family:${element.fontFamily}`}>{element.fontFamily}</option
                >{/if}</select
            ></label
          ><label
            >Size (mm)<input
              type="number"
              min=".1"
              step=".1"
              value={element.fontSize}
              onchange={(e) => patch(element.id, { fontSize: number(e.currentTarget.value) })}
            /></label
          >
        </div>
        <div class="font-tools">
          {#if supportsLocalFonts()}<button
              type="button"
              onclick={loadLocalFonts}
              disabled={fontBusy}
              title="Read the fonts installed on this device so a label can embed one"
              >{localFonts ? 'Reload system fonts' : 'Load system fonts…'}</button
            >{/if}
          {#if fontStatus}<p class="hint font-status" role="status">{fontStatus}</p>{/if}
        </div>
        <label
          >Overflow<select
            value={element.overflow}
            onchange={(e) => patch(element.id, { overflow: e.currentTarget.value })}
            ><option>no-wrap</option><option>word-wrap</option><option>clip</option><option>shrink-to-fit</option
            ><option>auto-height</option></select
          ></label
        >
        <div class="grid">
          <label
            >Horizontal<select
              value={element.horizontalAlign}
              onchange={(e) => patch(element.id, { horizontalAlign: e.currentTarget.value })}
              ><option>left</option><option>center</option><option>right</option></select
            ></label
          ><label
            >Vertical<select
              value={element.verticalAlign}
              onchange={(e) => patch(element.id, { verticalAlign: e.currentTarget.value })}
              ><option>top</option><option>middle</option><option>bottom</option></select
            ></label
          >
        </div>
      {:else if element.type === 'image'}
        <label
          >Resource<select
            value={element.resourceId}
            onchange={(e) => patch(element.id, { resourceId: e.currentTarget.value })}
            >{#each editor.document.resources as resource}<option value={resource.id}>{resource.name}</option
              >{/each}</select
          ></label
        ><label
          >Fit / aspect<select value={element.fit} onchange={(e) => patch(element.id, { fit: e.currentTarget.value })}
            ><option>contain</option><option>cover</option><option>stretch</option></select
          ></label
        >
        <fieldset>
          <legend>Crop (source-relative)</legend>
          <div class="grid">
            {#each ['x', 'y', 'width', 'height'] as key}<label
                >{key}<input
                  type="number"
                  step=".01"
                  min={key === 'width' || key === 'height' ? 0.01 : 0}
                  value={element.crop?.[key as keyof typeof element.crop] ??
                    (key === 'width' || key === 'height' ? 1 : 0)}
                  onchange={(e) =>
                    patch(element.id, {
                      crop: {
                        x: element.crop?.x ?? 0,
                        y: element.crop?.y ?? 0,
                        width: element.crop?.width ?? 1,
                        height: element.crop?.height ?? 1,
                        [key]: number(e.currentTarget.value),
                      },
                    })}
                /></label
              >{/each}
          </div>
        </fieldset>
        <label
          >Thermal rendering<select
            value={element.dither?.algorithm ?? 'auto'}
            onchange={(e) =>
              patch(element.id, {
                dither: { algorithm: e.currentTarget.value, threshold: element.dither?.threshold ?? 128 },
              })}
            ><option value="auto">Auto · balanced graphics</option><option value="floyd-steinberg"
              >Photo · smooth tones</option
            ><option value="atkinson">Photo · lighter detail</option><option value="bayer">Logo · crisp pattern</option
            ><option value="threshold">Line art · solid black/white</option></select
          ></label
        >
        {#if (element.dither?.algorithm ?? 'auto') === 'threshold'}<label
            >Black/white threshold<input
              type="range"
              min="0"
              max="255"
              value={element.dither?.threshold ?? 128}
              oninput={(e) =>
                patch(element.id, { dither: { algorithm: 'threshold', threshold: number(e.currentTarget.value) } })}
            /><span>{element.dither?.threshold ?? 128}</span></label
          >{/if}
        <label class="check"
          ><input
            type="checkbox"
            checked={element.invert === true}
            onchange={(e) => patch(element.id, { invert: e.currentTarget.checked })}
          /> Invert picture colors</label
        >
        <p class="render-help">
          Applied non-destructively at the selected printer's {editor.document.media.dpi} dpi. The original image is preserved.
        </p>
      {:else if element.type === 'svg'}<label
          >SVG resource<select
            value={element.resourceId}
            onchange={(e) => patch(element.id, { resourceId: e.currentTarget.value })}
            >{#each editor.document.resources.filter((r) => r.mimeType === 'image/svg+xml') as resource}<option
                value={resource.id}>{resource.name}</option
              >{/each}</select
          ></label
        >
      {:else if element.type === 'barcode'}<label
          >Data<input
            value={element.value}
            onchange={(e) => patch(element.id, { value: e.currentTarget.value })}
          /></label
        ><label
          >Symbology<select
            value={element.symbology}
            onchange={(e) => patch(element.id, { symbology: e.currentTarget.value })}
            ><option value="code128">Code 128</option><option value="ean13">EAN-13</option><option value="upca"
              >UPC-A</option
            ><option value="code39">Code 39</option></select
          ></label
        ><label class="check"
          ><input
            type="checkbox"
            checked={element.showText}
            onchange={(e) => patch(element.id, { showText: e.currentTarget.checked })}
          /> Human-readable text</label
        >
      {:else if element.type === 'qr'}<label
          >Data<textarea value={element.value} onchange={(e) => patch(element.id, { value: e.currentTarget.value })}
          ></textarea></label
        ><label
          >Error correction<select
            value={element.errorCorrection}
            onchange={(e) => patch(element.id, { errorCorrection: e.currentTarget.value })}
            ><option>L</option><option>M</option><option>Q</option><option>H</option></select
          ></label
        >
      {:else if element.type === 'line' || element.type === 'rectangle' || element.type === 'ellipse' || element.type === 'triangle'}<div
          class="grid"
        >
          <label
            >Stroke (mm)<input
              type="number"
              min="0"
              step=".1"
              value={element.strokeWidth}
              onchange={(e) => patch(element.id, { strokeWidth: number(e.currentTarget.value) })}
            /></label
          >{#if element.type !== 'line'}<label class="check"
              ><input
                type="checkbox"
                checked={element.filled}
                onchange={(e) => patch(element.id, { filled: e.currentTarget.checked })}
              /> Filled</label
            >{/if}
        </div>
      {:else if element.type === 'group'}<p>{element.childIds.length} child elements</p>{/if}
      <label
        >Assigned zone<select
          value={String(element.constraints?.find((item) => item.kind === 'zone')?.value ?? '')}
          onchange={(e) =>
            patch(element.id, {
              constraints: [
                ...(element.constraints ?? []).filter((item) => item.kind !== 'zone'),
                ...(e.currentTarget.value ? [{ kind: 'zone', value: e.currentTarget.value }] : []),
              ],
            })}
          ><option value="">None</option>{#each editor.document.media.zones ?? [] as zone}<option value={zone.id}
              >{zone.name}</option
            >{/each}</select
        ></label
      >
    {/each}{:else}<p>
      {editor.selectedElements.length
        ? `${editor.selectedElements.length} elements selected`
        : 'Select an element to inspect it.'}
    </p>{/if}
</Panel>

<style>
  .font-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-bottom: 0.4rem;
  }
  .font-status {
    flex-basis: 100%;
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  label {
    display: flex;
    flex-direction: column;
    font-size: var(--mble-text-small);
    margin-bottom: 0.5rem;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 0.3rem;
  }
  .render-help {
    margin: -0.2rem 0 0.55rem;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
    line-height: 1.35;
  }
  input,
  textarea,
  select {
    max-width: 100%;
    box-sizing: border-box;
  }
</style>
