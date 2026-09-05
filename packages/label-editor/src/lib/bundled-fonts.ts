// SPDX-License-Identifier: AGPL-3.0-or-later
import bundledFonts from '../../assets/fonts/bundled-fonts.json';
import { addFont } from './commands.js';
import { importFont } from './imports.js';
import type { FontResource } from './model.js';
import type { EditorStore } from './store.svelte.js';

export type BundledFont = (typeof bundledFonts)[number];
export { bundledFonts };

/**
 * Static URLs so the bundler emits the faces as assets, fetched on demand rather than inlined into
 * the app. Resolved lazily: the URL constructor needs a browser and must not run when the module loads.
 */
const bundledFontUrls: Record<string, () => string> = {
  'plex-sans-400.ttf': () => new URL('../../assets/fonts/plex-sans-400.ttf', import.meta.url).href,
  'plex-sans-700.ttf': () => new URL('../../assets/fonts/plex-sans-700.ttf', import.meta.url).href,
  'plex-mono-400.ttf': () => new URL('../../assets/fonts/plex-mono-400.ttf', import.meta.url).href,
  'plex-mono-700.ttf': () => new URL('../../assets/fonts/plex-mono-700.ttf', import.meta.url).href,
  'inter-400.ttf': () => new URL('../../assets/fonts/inter-400.ttf', import.meta.url).href,
  'inter-700.ttf': () => new URL('../../assets/fonts/inter-700.ttf', import.meta.url).href,
  'roboto-400.ttf': () => new URL('../../assets/fonts/roboto-400.ttf', import.meta.url).href,
  'roboto-700.ttf': () => new URL('../../assets/fonts/roboto-700.ttf', import.meta.url).href,
  'open-sans-400.ttf': () => new URL('../../assets/fonts/open-sans-400.ttf', import.meta.url).href,
  'open-sans-700.ttf': () => new URL('../../assets/fonts/open-sans-700.ttf', import.meta.url).href,
  'lato-400.ttf': () => new URL('../../assets/fonts/lato-400.ttf', import.meta.url).href,
  'lato-700.ttf': () => new URL('../../assets/fonts/lato-700.ttf', import.meta.url).href,
  'montserrat-400.ttf': () => new URL('../../assets/fonts/montserrat-400.ttf', import.meta.url).href,
  'montserrat-700.ttf': () => new URL('../../assets/fonts/montserrat-700.ttf', import.meta.url).href,
  'oswald-400.ttf': () => new URL('../../assets/fonts/oswald-400.ttf', import.meta.url).href,
  'oswald-700.ttf': () => new URL('../../assets/fonts/oswald-700.ttf', import.meta.url).href,
  'playfair-display-400.ttf': () => new URL('../../assets/fonts/playfair-display-400.ttf', import.meta.url).href,
  'playfair-display-700.ttf': () => new URL('../../assets/fonts/playfair-display-700.ttf', import.meta.url).href,
  'merriweather-400.ttf': () => new URL('../../assets/fonts/merriweather-400.ttf', import.meta.url).href,
  'merriweather-700.ttf': () => new URL('../../assets/fonts/merriweather-700.ttf', import.meta.url).href,
  'roboto-mono-400.ttf': () => new URL('../../assets/fonts/roboto-mono-400.ttf', import.meta.url).href,
  'roboto-mono-700.ttf': () => new URL('../../assets/fonts/roboto-mono-700.ttf', import.meta.url).href,
  'source-code-pro-400.ttf': () => new URL('../../assets/fonts/source-code-pro-400.ttf', import.meta.url).href,
  'source-code-pro-700.ttf': () => new URL('../../assets/fonts/source-code-pro-700.ttf', import.meta.url).href,
};
export const bundledFontUrl = (file: string): string => {
  const resolve = bundledFontUrls[file];
  if (!resolve) throw new Error(`Unknown bundled font ${file}`);
  return resolve();
};

export const bundledFontName = (item: BundledFont) => `${item.family} ${item.weight === 700 ? 'Bold' : 'Regular'}`;

/** The shipped face for a family and weight, if the editor bundles one. */
export function bundledFace(family: string, weight = 400): BundledFont | undefined {
  const lower = family.toLowerCase();
  const faces = bundledFonts.filter((item) => item.family.toLowerCase() === lower);
  return faces.find((item) => item.weight === weight) ?? faces[0];
}

/** Embeds a shipped face into the document, so a label prints in it without a catalogue or a network. */
export async function embedBundledFont(editor: EditorStore, item: BundledFont): Promise<FontResource> {
  const existing = editor.document.fonts.find((font) => font.sha256 === item.sha256);
  if (existing) return existing;
  const response = await fetch(bundledFontUrl(item.file));
  if (!response.ok) throw new Error(`${bundledFontName(item)} is unavailable (${response.status}).`);
  const data = new Uint8Array(await response.arrayBuffer());
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== item.sha256) throw new Error(`Bundled font hash mismatch for ${item.file}`);
  const imported = await importFont(new File([data as BlobPart], item.file, { type: item.mediaType }), {
    family: item.family,
    weight: item.weight,
    style: item.style as 'normal' | 'italic',
  });
  const named = { ...imported, name: bundledFontName(item) };
  editor.execute(addFont(named));
  return named;
}
