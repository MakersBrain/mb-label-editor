// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Components not yet converted to Svelte 5 runes mode.
 *
 * Both svelte.config.js files compile every other component with `runes: true`.
 * Entries are only ever removed; scripts/check-runes.mjs fails on stale ones.
 * Keyed by basename because the PWA compiles the package's dist copies.
 */
export const legacyComponents = new Set([
  'App.svelte',
  'AssetPanel.svelte',
  'Canvas.svelte',
  'DirectPrintPanel.svelte',
  'ExternalResourceConnectionsPanel.svelte',
  'LocalServicePanel.svelte',
  'SheetPanel.svelte',
]);
