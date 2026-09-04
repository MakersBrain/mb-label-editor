<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Third-party notices

The application links to Svelte, Vite, TypeScript, Playwright, Vitest, AJV,
`@makersbrain/ui`, and the sibling `@makersbrain/printer-sdk`. Package versions
and publisher license metadata are locked in `package-lock.json`. MakersBrain UI
is AGPL-3.0-only; its Bitter and IBM Plex Sans WOFF2 subsets retain the
SIL Open Font License 1.1. The label editor also bundles static IBM Plex Sans and
IBM Plex Mono TrueType faces (regular and bold) under the same licence, in
`packages/label-editor/assets/fonts`, so a label can embed a printable face
without a network fetch; `bundled-fonts.json` records each file's origin and hash. Public assets are original synthetic MakersBrain resources
with per-entry provenance and content hashes.

No Print Master, Ateliera, proprietary vendor catalogue, or APK-derived asset
is included. Local `.mb-assets` imports remain private browser data.
