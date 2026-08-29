<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Changelog

All notable changes follow Keep a Changelog and Semantic Versioning.

## Unreleased

- Split structural and standalone editor styles so the reusable package remains
  independent of MakersBrain UI and no longer injects a theme on import.
- Added the optional MB UI/Shadcn semantic adapter and applied it, including the
  canonical brand lockup and native light/dark palettes, to the hosted PWA.
- Added clean-package and browser acceptance for both styling modes.

## 0.1.0 - 2026-08-29

- Added the reusable Svelte 5 editor and installable offline PWA.
- Added canonical v4 SDK adapters, persistence, templates, and print routes.
- Added the synthetic licensed catalogue and publication policy checks.
- Added a usable IndexedDB document library, editable guides and view controls.
- Made pending WebUSB response reads cooperatively cancellable.
- Added aspect-preserving resize, template transform controls, capability-based
  media limits, library rename/delete, themes, private collection export, and
  offline PDF/File System Access browser acceptance.
- Added package-consumer, notices, PWA update, checksum, and release gates.
