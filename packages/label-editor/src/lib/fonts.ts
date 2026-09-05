// SPDX-License-Identifier: AGPL-3.0-or-later
import { addFont, patchElement } from './commands.js';
import type { ExternalFont, ExternalResourceProvider } from './external-resources/types.js';
import { importFont } from './imports.js';
import type { FontResource } from './model.js';
import type { EditorStore } from './store.svelte.js';

export type FontGeneric = 'sans-serif' | 'serif' | 'monospace' | 'cursive';
export interface FontChoice {
  name: string;
  generic: FontGeneric;
}
export interface FontGroup {
  label: string;
  families: FontChoice[];
}

/** Families every label designer expects to find, grouped the way a font menu reads. */
export const FONT_GROUPS: FontGroup[] = [
  {
    label: 'Sans-Serif',
    families: ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald', 'Arial', 'Helvetica'].map((name) => ({
      name,
      generic: 'sans-serif',
    })),
  },
  {
    label: 'Serif',
    families: ['Playfair Display', 'Merriweather', 'Georgia', 'Times New Roman'].map((name) => ({
      name,
      generic: 'serif',
    })),
  },
  {
    label: 'Monospace',
    families: ['Roboto Mono', 'Source Code Pro', 'Courier New'].map((name) => ({ name, generic: 'monospace' })),
  },
  {
    label: 'Display',
    families: [
      { name: 'Impact', generic: 'sans-serif' },
      { name: 'Comic Sans MS', generic: 'cursive' },
    ],
  },
];

/** The generic family the browser falls back to when a face is not embedded or installed. */
export function genericFor(family: string): FontGeneric {
  const lower = family.toLowerCase();
  for (const group of FONT_GROUPS)
    for (const choice of group.families) if (choice.name.toLowerCase() === lower) return choice.generic;
  if (/mono|code|courier/.test(lower)) return 'monospace';
  if (/serif/.test(lower) && !/sans/.test(lower)) return 'serif';
  return 'sans-serif';
}

/** CSS font-family value for the canvas: the family itself, then its generic. */
export function fontStack(family: string): string {
  return family === 'sans-serif' ? 'sans-serif' : `${JSON.stringify(family)},${genericFor(family)}`;
}

// ---- Local Font Access (Chromium): installed fonts, read with the user's permission ----

export interface LocalFontData {
  postscriptName: string;
  fullName: string;
  family: string;
  style: string;
  blob(): Promise<Blob>;
}
declare global {
  interface Window {
    queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<LocalFontData[]>;
  }
}
export const supportsLocalFonts = (): boolean =>
  typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';

/** Installed fonts grouped by family, sorted by name. Must run from a user gesture; the browser asks once. */
export async function queryLocalFontFamilies(): Promise<Map<string, LocalFontData[]>> {
  if (!supportsLocalFonts()) return new Map();
  const faces = await window.queryLocalFonts!();
  const families = new Map<string, LocalFontData[]>();
  for (const face of faces) {
    const list = families.get(face.family) ?? [];
    list.push(face);
    families.set(face.family, list);
  }
  return new Map([...families.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Weight and slant read from a face's style name ("Bold Italic", "SemiBold", "Light"). */
export function faceMetrics(style: string): { weight: number; style: 'normal' | 'italic' } {
  const lower = style.toLowerCase();
  const weight = /thin|hairline/.test(lower)
    ? 100
    : /extra ?light|ultra ?light/.test(lower)
      ? 200
      : /light/.test(lower)
        ? 300
        : /medium/.test(lower)
          ? 500
          : /semi ?bold|demi ?bold/.test(lower)
            ? 600
            : /extra ?bold|ultra ?bold/.test(lower)
              ? 800
              : /black|heavy/.test(lower)
                ? 900
                : /bold/.test(lower)
                  ? 700
                  : 400;
  return { weight, style: /italic|oblique/.test(lower) ? 'italic' : 'normal' };
}

/** The face closest to the wanted weight and slant; upright regular wins ties. */
export function pickFace(faces: LocalFontData[], weight = 400, style: 'normal' | 'italic' = 'normal') {
  return [...faces].sort((a, b) => {
    const ma = faceMetrics(a.style);
    const mb = faceMetrics(b.style);
    const da = Math.abs(ma.weight - weight) + (ma.style === style ? 0 : 1000);
    const db = Math.abs(mb.weight - weight) + (mb.style === style ? 0 : 1000);
    return da - db;
  })[0];
}

// ---- Embedding: fonts print exactly only when their bytes travel with the label ----

/** Puts the element on a font already in the document. */
export function applyFont(editor: EditorStore, elementId: string, font: FontResource) {
  editor.execute(
    patchElement(elementId, { fontResourceId: font.id, fontFamily: font.family, fontWeight: font.weight }),
  );
}
/** Names a family the browser may have without embedding bytes; the printer falls back to its default face. */
export function applyFamily(editor: EditorStore, elementId: string, family: string) {
  editor.execute(patchElement(elementId, { fontResourceId: undefined, fontFamily: family, fontWeight: 400 }));
}
export function embeddedFont(editor: EditorStore, family: string, weight = 400): FontResource | undefined {
  const lower = family.toLowerCase();
  const candidates = editor.document.fonts.filter((font) => font.family.toLowerCase() === lower);
  return candidates.find((font) => font.weight === weight && font.style === 'normal') ?? candidates[0];
}

export async function embedLocalFont(editor: EditorStore, face: LocalFontData): Promise<FontResource> {
  const metrics = faceMetrics(face.style);
  const blob = await face.blob();
  const imported = await importFont(
    new File([blob], `${face.postscriptName || face.family}.ttf`, { type: blob.type }),
    {
      family: face.family,
      weight: metrics.weight,
      style: metrics.style,
    },
  );
  const existing = editor.document.fonts.find((font) => font.sha256 === imported.sha256);
  if (existing) return existing;
  const named = { ...imported, name: face.fullName || `${face.family} ${metrics.weight}` };
  editor.execute(addFont(named));
  return named;
}

/** Downloads the regular face of `family` from the catalogue and embeds it; undefined when the catalogue lacks it. */
export async function embedProviderFont(
  editor: EditorStore,
  provider: ExternalResourceProvider,
  family: string,
): Promise<FontResource | undefined> {
  const page = await provider.searchFonts({ query: family, pageSize: 10 });
  const lower = family.toLowerCase();
  let match: ExternalFont | undefined = page.items.find((item) => item.family.toLowerCase() === lower);
  if (!match) return undefined;
  if (!match.faces.length || match.availability === 'remote') {
    if (!provider.cacheFont) throw new Error(`${provider.displayName} cannot cache remote fonts.`);
    const preferred = match.variants.includes('regular') ? ['regular'] : match.variants.slice(0, 1);
    match = await provider.cacheFont(match.id, preferred);
  }
  const face = match.faces.find((candidate) => candidate.variant === 'regular') ?? match.faces[0];
  if (!face) throw new Error(`${match.family} has no downloadable font face.`);
  const blob = await provider.fetchBlob(face.fileUrl);
  const extension = face.format === 'opentype' ? 'otf' : face.format === 'collection' ? 'ttc' : 'ttf';
  const mimeType = blob.type || (extension === 'ttc' ? 'font/collection' : `font/${extension}`);
  const imported = await importFont(new File([blob], `${match.family}.${extension}`, { type: mimeType }), {
    family: face.familyName || match.family,
    weight: face.weight,
    style: face.style === 'italic' ? 'italic' : 'normal',
  });
  const existing = editor.document.fonts.find((font) => font.sha256 === imported.sha256);
  if (existing) return existing;
  editor.execute(addFont(imported));
  return imported;
}
