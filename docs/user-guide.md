<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# User guide

Create a label with the toolbar, then set exact media dimensions and optional
independent or cloned zones in **Media & zones**. The inspector edits element
geometry, content, resources, overflow, rotation, and zone assignment. Layers,
alignment, distribution, ordering, grouping, snapping, rulers, touch pan/zoom,
and bounded undo/redo are available without a printer.

Import CSV in **Data & templates**, map each text/barcode/QR element to a field,
preview records, and use **Batch** to inspect page/zone placement. Template
expressions use the SDK allowlist only; arbitrary code is never evaluated.
Export the current label as physical-size PNG or PDF, or export a batch PDF.

Documents, autosaves, preferences, templates, recents, favorites, and private
assets stay in browser storage. `.mb-label.json` files are portable v4
documents. `.mb-assets` collections are private imports and are excluded from
public build output. Ambiguous interrupted print jobs require an explicit retry
after inspecting the physical printer.

The app works offline after its first successful load. Device permission and
local-service pairing cannot be completed offline.
