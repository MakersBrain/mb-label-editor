<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Classic printer label-sheet support plan

Status: implemented locally; pending merged SDK pins and physical qualification

Date: 2026-08-30

Architecture prerequisite: `docs/label-printing-editor-architecture-plan.md`.
That plan owns shared limits, render policy, error, tracing, executor, and
cross-repository pinning decisions. Sheet fixtures and benchmarks may be
prepared alongside architecture work. Do not implement the sheet Rust/WASM API
until architecture Phases 0–3 pass, and do not begin editor integration until
architecture Phases 0–5 pass.

## Implementation record

The first-release software path is implemented locally:

- Rust grid and explicit-slot normalization use integer micrometres, checked
  arithmetic, exact label-size matching, bounded pages/items/pixels/output, and
  deterministic row/column ordering;
- PDF export renders at 300 DPI in the editor, retains the CLI's explicit DPI,
  packs completed monochrome pages, and preserves exact A4/Letter page
  dimensions (the core remains capable of validated custom dimensions);
- WASM exposes `planSheet` and `buildSheetPdf` with structured sheet errors;
- the editor ships generic A4 and Letter grids, custom A4/Letter grids,
  first-unused-slot selection, copies/CSV records, preferences, preview,
  download/open-PDF actions, and Actual size / 100% guidance;
- the legacy CLI sheet flags now use the same core planner/exporter; and
- Rust, Node/WASM, TypeScript, and compiled-browser coverage exercises the
  authoritative path.

Release completion remains intentionally gated on merging the SDK first and
advancing both host pins to its merged `main` SHA. Physical alignment must be
recorded with `docs/label-sheet-qualification.md`; deterministic PDF dimensions
do not by themselves prove registration on every printer and stock combination.

## 1. Decision

Add a sheet-printing workflow for ordinary inkjet and laser printers. A user
continues to design one label at its real physical size, then chooses a paper
and label-sheet layout when exporting or printing. The application imposes one
or more labels onto exact-size PDF pages and hands that PDF to the browser or
operating system print dialog.

Keep these concepts separate:

- a canonical v4 `Document` describes one label and remains the source of
  truth for editing, thermal rendering, and thermal printing;
- a `SheetLayout` describes the carrier paper and the positions of labels on
  that paper; and
- a `SheetJob` describes one export operation, including the starting slot and
  copies or materialized records.

Do not change the canonical v4 schema in the first release. Sheet layout is an
output concern and must not make an otherwise portable label dependent on A4,
Letter, a particular brand of stationery, or a desktop printer.

```text
canonical label(s)       verified layout preset       job options
        |                         |                         |
        +-------------------------+-------------------------+
                                  |
                                  v
                    deterministic Rust imposition
                                  |
                     exact physical-size PDF pages
                                  |
                   browser / operating-system dialog
                                  |
                         inkjet or laser printer
```

## 2. User outcome and terminology

“Classic printer” means a general-purpose printer exposed through the normal
browser or operating-system print workflow. It does not mean a new thermal
printer protocol, a fake SDK printer definition, or silent access to an
arbitrary local printer.

The first release lets a user:

- choose A4 or US Letter paper in portrait or landscape;
- choose a predefined generic label grid or enter custom measurements;
- see a full-sheet preview before output;
- start at a selected unused slot on a partially consumed sheet;
- fill the sheet with copies of the current label or with materialized CSV
  records;
- export a deterministic, exact-size, multi-page PDF; and
- open that PDF for printing with explicit “Actual size / 100%” guidance.

Use the following terms consistently in code and UI:

- **paper**: the physical A4, Letter, or custom carrier sheet;
- **label**: one adhesive label and the canonical document designed for it;
- **slot**: one label position on a sheet;
- **layout**: paper geometry plus its ordered slots;
- **imposition**: placing rendered labels into slots; and
- **calibration**: a future printer-specific translation used to correct feed
  and registration offsets; it is not part of the first release.

Do not call paper “media” in the new public API because `Document.media`
already means the canonical label’s own physical area.

## 3. Scope

### 3.1 First release

- A4 portrait and landscape: exactly 210,000 × 297,000 micrometres before
  orientation is applied.
- US Letter portrait and landscape: exactly 215,900 × 279,400 micrometres
  before orientation is applied.
- Custom rectangular grids on A4 or US Letter, expressed in micrometres at the
  Rust boundary and millimetres in the UI.
- Generic rectangular grids described by rows, columns, label dimensions,
  top/left margins, and horizontal/vertical gaps.
- Checked-in explicit-slot layouts for products that cannot be represented by
  a uniform grid. The first custom-layout UI supports grids only.
- Current-label copies and existing CSV/template batches.
- A selectable first slot, row-major or column-major fill order, and multiple
  output pages.
- Exact-size editor monochrome PDF at 300 DPI using the existing deterministic
  renderer. The shared core also preserves the CLI's explicit DPI.
- A saved last-used layout in browser-local preferences.

### 3.2 Follow-up scope

- Verified manufacturer/product-code presets sourced from primary technical
  specifications.
- Arbitrary custom paper width and height in the editor; the Rust definition
  already accepts validated integer paper dimensions.
- A named library of reusable custom layouts.
- Import and export of user-defined layout profiles.
- Per-printer calibration profiles.
- A calibration-test page with rulers and registration marks.
- Optional native CUPS/IPP submission through an explicit local-service
  capability.
- Grayscale or colour office-printer output if the canonical rendering model
  is extended deliberately.

### 3.3 Non-goals

- Silent or unattended browser printing.
- Detecting which physical sheet the user loaded.
- Selecting browser print-dialog options programmatically.
- Treating a desktop printer as a thermal `PrinterDefinition`.
- Reusing thermal direct, local API, or cloud routes for PDF printing.
- Scraping label-vendor websites at runtime.
- Shipping unverified branded measurements.
- Automatically scaling a label to fit a mismatched slot.
- Adding crop marks to commercial die-cut sheets by default.
- Colour management, duplex printing, or edge-to-edge photo printing.

## 4. Existing architecture and required boundaries

The current editor already stores label dimensions in millimetres, adapts them
to canonical micrometres, renders through the Rust/WASM SDK, and exports PDF
pages with authoritative physical dimensions. `renderBatchPdf` currently emits
one PDF page per input document. Existing zones place elements within a label
document and support record layout, but they are not persisted paper layouts.

Preserve these boundaries:

```text
mb-label-editor
  UI, local preferences, preset selection, CSV materialization, preview state

mb-printer-wasm
  narrow serialization and JavaScript error boundary

mb-printer-core
  validated geometry, deterministic slot calculation, raster imposition,
  exact-size PDF construction

browser / OS
  printer selection, driver settings, spool submission, physical output
```

The editor may calculate a lightweight preview for interaction, but Rust owns
authoritative layout validation and the exported bytes. Do not implement a
second authoritative imposition algorithm in TypeScript.

## 5. Rust domain design

Add `mb-printer-core/src/sheet.rs` and export it from `lib.rs`. Keep public
types small, owned, serializable where needed, and independent of browser or
native APIs.

```rust
use std::num::NonZeroU16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FillOrder {
    RowMajor,
    ColumnMajor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SheetSlot {
    pub x_um: i64,
    pub y_um: i64,
    pub width_um: i64,
    pub height_um: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SheetGrid {
    pub id: String,
    pub paper_width_um: i64,
    pub paper_height_um: i64,
    pub rows: u16,
    pub columns: u16,
    pub label_width_um: i64,
    pub label_height_um: i64,
    pub margin_left_um: i64,
    pub margin_top_um: i64,
    pub gap_x_um: i64,
    pub gap_y_um: i64,
    pub fill_order: FillOrder,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SheetLayout {
    pub id: String,
    pub paper_width_um: i64,
    pub paper_height_um: i64,
    pub slots: Vec<SheetSlot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SheetDefinition {
    Grid {
        #[serde(flatten)]
        grid: SheetGrid,
    },
    Explicit {
        #[serde(flatten)]
        layout: SheetLayout,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SheetOptions {
    pub first_slot: usize,
    pub dpi: NonZeroU16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SheetPlanInput {
    pub item_count: u32,
    pub label_width_um: i64,
    pub label_height_um: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SheetPlacement {
    pub item: usize,
    pub page: usize,
    pub slot: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SheetPlan {
    pub page_count: usize,
    pub layout: SheetLayout,
    pub placements: Vec<SheetPlacement>,
}
```

`SheetLayout.slots` is the normalized core representation. Rust expands a
`SheetGrid` into that representation, including its fill order. An explicit
layout uses vector order as its canonical order and is not re-sorted. This
makes the slot number shown in preview identical to the slot used for
`first_slot` and export. An explicit slot list leaves room for staggered
products without adding an irregular-layout editor to the first release.

Use integer micrometres for all authoritative physical geometry. Convert to
dots with the SDK’s existing half-away-from-zero rules. Never use binary
floating point to accumulate rows, columns, pitch, or page positions.

### 5.1 Core API

Expose focused operations:

```rust
pub fn normalize_layout(definition: &SheetDefinition) -> Result<SheetLayout, SheetError>;

pub fn validate_layout(layout: &SheetLayout) -> Result<(), SheetError>;

pub fn plan(
    input: SheetPlanInput,
    definition: &SheetDefinition,
    options: SheetOptions,
    limits: &ProcessingLimits,
) -> Result<SheetPlan, SheetError>;

pub fn pdf(
    documents: &[Document],
    definition: &SheetDefinition,
    options: SheetOptions,
    limits: &ProcessingLimits,
) -> Result<Vec<u8>, SheetError>;
```

`plan` operates only on item count and physical label dimensions so interactive
preview never serializes full documents or embedded resources. `pdf` derives
the equivalent planning input from its document slice, validates every
document, and calls the same normalization, validation, and placement functions.
Keep raster imposition private to the module and test it there. Do not expose a
vector of full-page rasters, a stateful builder, a global preset registry, or a
trait hierarchy for this fixed operation.

Add a small packed-page input to `export` so `pdf` can convert each completed
page from the current one-byte-per-pixel `MonoRaster` to one-bit rows and drop
the full raster before rendering the next page. The PDF writer may retain the
packed page data, but must not retain all full `MonoRaster` pages. Use a checked
conservative output estimate and a small bounded output buffer that rejects an
append before `max_output_bytes` is exceeded. This bounds the dominant
page-storage and output cost without introducing streaming I/O or a complex
incremental PDF API.

Accept already materialized `Document` values. CSV parsing and template record
selection remain editor responsibilities; the core must not learn about UI
state or IndexedDB.

Move the existing `makersbrain.render:dither` interpretation from the WASM
crate into one shared `mb-printer-core` helper. Existing PNG/PDF rendering and
new sheet rendering must use that helper so the sheet path preserves document
dither semantics without duplicating extension parsing.

### 5.2 Validation invariants

Return errors before allocating page rasters. Validate that:

- the layout ID is non-empty and bounded in length;
- paper and slot dimensions are positive;
- DPI is non-zero and the paper dimensions at the selected DPI fit the
  renderer’s checked allocation limits;
- at least one slot exists and slot count is bounded;
- every slot is fully within the uncalibrated paper;
- slots do not overlap;
- every input document passes canonical v4 validation;
- every input label’s physical width and height exactly match its target slot;
- `first_slot` is less than the number of slots when documents are present; and
- checked arithmetic cannot overflow while calculating dots, pages, or byte
  counts.

An item count of zero is invalid for planning, and an empty document slice is
invalid for export, matching existing empty-PDF behaviour.
Do not scale mismatched labels. Return a diagnostic that names the expected and
actual dimensions so the user can select the correct preset or resize the
label explicitly.

The initial overlap check may be the clear O(n²) rectangle comparison because
the slot count is strictly bounded and real sheets contain few slots. Prefer
obvious, auditable code over a spatial index until profiling justifies one.

### 5.3 Rendering and imposition algorithm

For each output page:

1. Allocate one white `MonoRaster` at the paper’s exact dimensions and selected
   DPI using checked constructors.
2. Select the ordered usable slots. Apply `first_slot` only on page one; all
   later pages begin at slot zero.
3. Clone each canonical document, replace only its DPI with the selected DPI,
   validate it again, and render it with the shared document render-options
   helper.
4. Convert the slot origin from micrometres to dots using the shared conversion
   helper.
5. Blit the rendered label raster into the page raster. Clip at the source
   label boundary, not by silently shrinking it.
6. Pack the completed page to one-bit rows, release its full raster, and
   continue until every input document is placed.
7. Pass the packed pages to the exact-size PDF writer with the authoritative
   paper width and height.

Add a checked `MonoRaster::blit` helper only if the raster module lacks an
equivalent. Its contract must define source/destination clipping and return a
typed error for impossible coordinates or arithmetic overflow. Avoid indexing
with unchecked casts.

Raster imposition is preferred over merging canonical element trees because it:

- preserves the label as the independently validated render unit;
- avoids rewriting element, group, resource, and zone IDs;
- naturally clips content at the label edge;
- reuses the current deterministic rendering path; and
- keeps temporary sheet pages out of the canonical document format.

The trade-off is that first-release office output remains bilevel raster PDF.
Document this honestly; do not imply vector, grayscale, or colour output.

### 5.4 Typed errors

Use `thiserror` and one domain error enum. Do not use `anyhow` in the reusable
library and do not encode control flow in error strings.

```rust
#[derive(Debug, Error)]
pub enum SheetError {
    #[error("sheet jobs require at least one item")]
    EmptyJob,
    #[error("sheet layout contains no slots")]
    EmptyLayout,
    #[error("invalid paper dimensions: {width_um} × {height_um} µm")]
    InvalidPaper { width_um: i64, height_um: i64 },
    #[error("slot {index} is outside the paper")]
    SlotOutsidePaper { index: usize },
    #[error("slots {left} and {right} overlap")]
    OverlappingSlots { left: usize, right: usize },
    #[error("label {item} is {actual_width_um} × {actual_height_um} µm; slot expects {expected_width_um} × {expected_height_um} µm")]
    LabelSizeMismatch {
        item: usize,
        actual_width_um: i64,
        actual_height_um: i64,
        expected_width_um: i64,
        expected_height_um: i64,
    },
    #[error("sheet raster exceeds the configured allocation limit")]
    RasterTooLarge,
    #[error("sheet PDF exceeds the configured {limit}-byte output limit")]
    OutputTooLarge { limit: usize },
    #[error("sheet geometry overflowed")]
    GeometryOverflow,
    #[error("label {item} is invalid")]
    InvalidDocument { item: usize, errors: Vec<ValidationError> },
    #[error("label {item} could not be rendered")]
    Render { item: usize, #[source] source: RenderError },
    #[error(transparent)]
    Export(#[from] ExportError),
}
```

Give the enum a stable `code() -> &'static str` mapping for the WASM boundary,
for example `sheet.label_size_mismatch`. The display message remains suitable
for a person; UI branching and telemetry use the code.

Do not `unwrap`, `expect`, panic, or saturate invalid user geometry. `expect`
remains acceptable only for compile-time/static invariants already established
by construction, matching the narrow existing usage in the SDK.

### 5.5 Rust idioms and quality rules

- Retain `#![forbid(unsafe_code)]` in `mb-printer-core` and
  `mb-printer-wasm`.
- Use edition 2024 and the workspace MSRV; do not introduce APIs newer than the
  declared `rust-version`.
- Prefer slices and borrowed inputs at computation boundaries; return owned
  page rasters and PDF bytes.
- Use newtypes only where they prevent a real unit/index mix-up. Do not wrap
  every integer mechanically.
- Derive `Debug`, `Clone`, `Copy`, `PartialEq`, and `Eq` only where their
  semantics are correct.
- Mark serialized request structs with `deny_unknown_fields` and an explicit
  rename convention.
- Use `BTreeMap`/stable iteration where serialized or rendered order affects
  deterministic output.
- Keep functions small around validation, ordering, page planning, and blitting
  so each invariant is directly unit tested.
- Use checked `i64`, `u32`, and `usize` conversions with `try_from`; do not use
  lossy `as` casts for external values.
- Document public APIs and non-obvious rounding or clipping behaviour.
- Run `cargo fmt`, `cargo clippy --workspace --all-targets --all-features --
  -D warnings`, and `cargo test --workspace`.

Add explicit workspace lint configuration if the SDK adopts it for all crates;
do not enable a large pedantic lint set only in the new module. Fix relevant
warnings rather than adding broad `allow` attributes.

## 6. Preset catalogue

Add a checked-in catalogue in the editor package, for example:

```text
packages/label-editor/assets/sheet-layouts.json
packages/label-editor/src/lib/sheets/catalogue.ts
```

Each entry contains:

```ts
interface SheetLayoutPreset {
  id: string;
  name: string;
  paper: 'a4' | 'letter' | 'custom';
  orientation: 'portrait' | 'landscape';
  grid?: {
    rows: number;
    columns: number;
    labelWidthMm: number;
    labelHeightMm: number;
    marginLeftMm: number;
    marginTopMm: number;
    gapXmm: number;
    gapYmm: number;
    fillOrder: 'row-major' | 'column-major';
  };
  slots?: Array<{ xMm: number; yMm: number; widthMm: number; heightMm: number }>;
  source?: { url: string; checkedAt: string; productCode?: string };
}
```

Require exactly one of `grid` and `slots`. Validate the JSON at build/test time
and pass normalized integer micrometres to Rust. Decimal strings are preferable
in source JSON if conversion through JavaScript numbers could obscure exact
manufacturer dimensions; centralize decimal-to-micrometre conversion and test
it.

The MVP catalogue should contain paper definitions and a small set of clearly
named generic grids. Add a branded/product-code entry only after checking a
primary manufacturer specification and recording its source. Product names are
identifiers, not an assertion of endorsement. Never infer measurements from a
marketing name or another vendor’s “compatible” sheet.

Built-in IDs are reserved. The first release uses one transient `custom` grid
from preferences rather than adding it to or mutating the shipped catalogue.

## 7. WASM boundary

Add one high-level binding rather than exposing every internal geometry helper:

```text
planSheet(planInputJson, layoutJson, optionsJson) -> SheetPlan
buildSheetPdf(documentsJson, layoutJson, optionsJson) -> Uint8Array
```

`planSheet` returns page count and normalized slot placements for UI preview. It
receives only item count and physical label dimensions, not complete documents.
It is required, and it must call the same Rust normalization, validation, and
ordering functions used by `buildSheetPdf`.

Parse each input exactly once. Keep deserialization, domain invocation, and
error conversion as three obvious steps. Return a structured JavaScript error
with stable `code` and safe public fields; do not flatten all failures to an
unclassifiable string in the new API merely because older bindings do so.

The binding must not install a global tracing subscriber. A reusable WASM
package does not own the host application’s logging policy.

Extend the editor’s narrow `PrinterSdk` interface with sheet-specific methods,
but consider renaming that interface in a later independent refactor because
PDF layout is not printer protocol functionality. Do not combine that rename
with this feature.

```ts
interface SheetPlan {
  pageCount: number;
  layout: {
    paperWidthUm: number;
    paperHeightUm: number;
    slots: Array<{ xUm: number; yUm: number; widthUm: number; heightUm: number }>;
  };
  placements: Array<{ item: number; page: number; slot: number }>;
}

interface SheetPlanInput {
  itemCount: number;
  labelWidthUm: number;
  labelHeightUm: number;
}

interface SheetOptions {
  firstSlot: number;
  dpi: number;
}

planSheet(input, layout, options): Promise<SheetPlan>;
exportSheetPdf(documents, layout, options): Promise<Uint8Array>;
```

The editor always supplies 300 DPI in the first release. The WASM wire DTO
accepts an integer and converts it to `NonZeroU16` before invoking core. The
shared core keeps DPI explicit so the CLI adapter can preserve its existing
`--dpi` contract.

## 8. Tracing and diagnostics

Use `tracing` as a library facade in Rust and preserve host ownership of
subscriber configuration.

Add `tracing` to workspace dependencies with the attribute feature if
`#[instrument]` is used. Instrument coarse operations, not pixels or every
slot:

- `sheet.plan`: debug span with paper dimensions, DPI, slot count, input count,
  first slot, and fill order;
- `sheet.impose`: debug span with planned page count and bounded raster size;
- `sheet.page`: debug span with page index and item count; and
- `sheet.pdf`: debug span with page count and final byte length.

Use `#[instrument(skip_all, fields(...))]` or explicit spans so documents,
serialized JSON, element text, barcodes, CSV fields, resource bytes, file names,
and customer data are never captured. Do not use the automatic `err` field on
these spans because a nested validation error can contain a document-defined
identifier. Record dimensions and counts, not contents. On failure record only
the stable error code at warning level; the caller owns user-facing text.

The core library emits spans but never calls `set_global_default`, initializes
`tracing_subscriber`, selects a filter, or writes directly to stdout/stderr.
Native binaries may attach their existing subscriber. Rust spans are inert in
the browser unless a host deliberately installs a compatible subscriber. For
the browser workflow, use a small host-provided diagnostics callback around the
WASM call:

```ts
type SheetDiagnostic = {
  operation: 'plan' | 'export';
  outcome: 'completed' | 'failed';
  durationMs: number;
  pages?: number;
  items: number;
  errorCode?: string;
};
```

Do not log diagnostics by default and do not include label/document content.
The standalone PWA consumes the event only for status and duration reporting;
an embedding host may forward it to its own telemetry. Tests verify that the
callback fires and contains only the documented bounded fields.

Avoid high-cardinality or sensitive fields in future native metrics. Layout ID
is acceptable only for a bounded built-in catalogue; custom IDs must be
reported as `custom`.

## 9. Editor package design

Add focused modules:

```text
src/lib/sheets/types.ts          UI-facing types and type guards
src/lib/sheets/catalogue.ts      built-in preset access
src/lib/sheets/normalize.ts      exact mm -> µm request conversion
src/lib/sheets/job.ts            copies/records -> materialized documents
src/lib/components/SheetPanel.svelte
```

Do not add sheet logic to `MediaPanel.svelte`: that panel edits the label’s
canonical media. Add **Print → Label sheet…** and open `SheetPanel` from the PWA
and reusable host integration.

`SheetPanel` contains:

- output mode: current label copies or CSV records;
- paper preset and orientation;
- label-layout preset or custom layout;
- an exact dimension summary;
- rows, columns, margins, gaps, and label dimensions for custom grids;
- first unused label selection shown directly on the sheet preview;
- row-major/column-major fill order;
- copies or selected records;
- a read-only 300 DPI monochrome output summary;
- estimated page count;
- **Export sheet PDF**; and
- **Open print PDF** where browser capabilities permit it.

Disable output until Rust validation succeeds. Show size mismatch as a direct
comparison: “This label is 50 × 30 mm; the selected sheet expects 63.5 × 33.9
mm.” Offer an explicit route to edit label size, but never silently resize.

The visual preview can use normalized placements returned by Rust and ordinary
CSS boxes. It is a geometry preview, not a claim of pixel-identical rendering.
Reuse the existing SDK raster preview only for a selected slot if a content
preview is needed; avoid rendering every full sheet on each form input.
Fill-order selection applies to grid definitions. Checked-in explicit layouts
use their declared slot order and disable that control.

## 10. Batch and partial-sheet semantics

Build the job’s ordered document list before calling Rust:

- current-label mode clones the current canonical document `copies` times;
- CSV mode uses the existing deterministic `materializeRecord` path;
- record selection, if added, preserves displayed record order; and
- empty batches are rejected before WASM invocation.

`first_slot` applies only to the first output page. This supports a partially
used physical sheet without wasting the corresponding labels on later pages.
The first page contains at most `slot_count - first_slot` items; every later
page uses all slots.

Do not persist an automatic “next unused slot” after export because exporting a
PDF does not prove that paper was printed. The user explicitly selects the
starting slot for each job.

Copies and records fill one ordered sequence. Do not intermingle thermal batch
printing with sheet export, and do not submit one PDF page as multiple thermal
jobs.

## 11. Persistence and compatibility

Extend browser preferences with a versioned sheet settings object:

```ts
type SheetGridInput = NonNullable<SheetLayoutPreset['grid']>;

interface SheetPreferencesV1 {
  version: 1;
  layoutId: string;
  fillOrder: 'row-major' | 'column-major';
  lastCustomGrid?: SheetGridInput;
}
```

Remember at most the last custom grid inside the existing versioned preferences
record. Validate it on read and discard it if invalid. Do not add a dedicated
custom-layout store, naming workflow, import/export format, or migration system
in the first release; those belong to the future named-layout library.

Do not store `firstSlot`, copies, selected records, calibration offsets, or
“printed” state as a preference. The browser cannot identify which printer the
system dialog will use, so persisting an offset could silently apply one
printer’s correction to another. Calibration remains a future named,
printer-specific profile. Do not put sheet preferences in `.mb-label.json` v4
extensions in the first release. Existing documents, autosaves, thermal jobs,
and exported files remain byte/schema compatible.

If portable sheet recipes become necessary later, define a separate
`.mb-sheet-layout.json` format rather than overloading the canonical label
schema.

## 12. Browser printing behaviour

PDF export is the authoritative success condition. Browser printing is a
convenience action layered on the same bytes.

The application may open a blob URL in a new tab or a dedicated print frame
from a direct user gesture. It must handle popup blocking, revoke object URLs
only after the consumer has loaded them, and always retain a download fallback.
Do not report “Printed” merely because `window.print()` returned; browsers do
not provide authoritative spool or physical completion status.

Use wording such as:

> PDF ready. In the print dialog choose Actual size or 100%, disable Fit to
> page, select the matching paper size, and verify the preview before printing.

The operation status is `PDF ready` or `Print dialog opened`, never
`completed`, because physical outcome is unknown.

Native CUPS/IPP support, if later authorized, belongs behind a new explicit
document-print capability in the local service. It needs format negotiation,
job identity, cancellation semantics, and spool-state reporting; it must not be
hidden behind an existing thermal `PrintRoute` implementation.

### 12.1 Existing CLI sheet compatibility

`mb-printer-cli` already exposes A4 grid flags and implements
`raster::sheet_pdf`. Preserve those flags through a compatibility adapter that
constructs the new core `SheetDefinition` and calls the same core PDF function.
Pass the existing CLI `--dpi` value into `SheetOptions`; do not silently change
the CLI default or its accepted non-300 values. The editor remains fixed at 300
DPI independently.

Keep cut marks as an explicit CLI-only compatibility option or deprecate them
with a release note; never add them to commercial label presets by default.
Delete the duplicate float-based CLI imposition after parity tests pass.

## 13. Security and resource limits

- Bound paper dimensions, DPI, slot count, input document count, page count,
  total raster pixels, and total estimated allocation before rendering.
- Use checked multiplication when deriving width × height, page count, and PDF
  capacity.
- Enforce encoded request limits before deserializing at WASM/CLI boundaries.
  Enforce typed processing limits inside core after deserialization.
- Calculate a conservative PDF capacity before rendering and use a bounded
  writer/buffer that fails before an append would exceed `max_output_bytes`.
- Show a busy state while the bounded synchronous WASM export runs. Do not
  promise per-page progress or cancellation in the first release. If measured
  export time still blocks interaction unacceptably, move the unchanged
  high-level call into a Web Worker as a focused follow-up.
- Never place document content or binary resources in trace fields or error
  reports.
- Treat preset JSON and custom-grid input as untrusted and validate both.
- Keep rendering offline; no preset or PDF data is sent to a service.
- Escape preset display names as text through Svelte; never render catalogue
  strings as HTML.
- Revoke generated blob URLs and avoid retaining duplicate PDF buffers longer
  than necessary.

Choose conservative initial limits from measured browser memory use and record
them as named constants with tests. Benchmark A4 at the fixed 300 DPI before
fixing those limits; do not guess and silently rely on allocation failure.

## 14. Testing strategy

### 14.1 Rust unit and property tests

Cover:

- exact A4 and Letter normalization;
- portrait/landscape dimension swapping;
- grid expansion with integer micrometre pitch;
- row-major and column-major ordering;
- first-slot behaviour on only the first page;
- page counts at zero/one/full/overflow boundaries;
- slot containment and pairwise overlap rejection;
- negative dimensions, excessive pages, and arithmetic overflow;
- exact label/slot size matching and actionable mismatch errors;
- raster blitting at every page edge;
- deterministic output for identical inputs; and
- no mutation of input documents.

Use table-driven tests for geometry. Add property tests only if the workspace
accepts the dependency and they cover meaningful invariants such as “every
planned item appears exactly once” and “every generated slot is contained.” Do
not replace readable examples with opaque generated tests.

### 14.2 Rust golden and integration tests

- Check normalized PDF page dimensions, not only the `%PDF` header.
- Decode representative output and assert black-pixel bounding boxes land in
  the expected slots within the shared rounding tolerance.
- Include a two-page partial-sheet fixture.
- Add a byte-stability golden only after output is intentional and stable.
- Exercise 300 DPI at the documented memory and page limits.
- Run a CLI compatibility fixture at its existing default 203 DPI and at one
  explicit non-default DPI.
- Run native and WASM/Node equivalence for the same sheet request.
- Verify malformed/unknown JSON fields fail at the WASM boundary.

Do not use a physical print as a substitute for deterministic tests. Maintain
a separate signed hardware qualification record for each paper/printer/layout
combination used to claim real-world acceptance.

### 14.3 TypeScript and component tests

- Preset catalogue schema and unique IDs.
- Exact decimal millimetre-to-micrometre normalization.
- Last custom-grid preference validation and restoration.
- Current-label copy and CSV materialization order.
- Structured Rust error mapping.
- Disabled export for size mismatch or invalid layout.
- First-slot selection and page estimate.
- PDF download filename, MIME type, and blob URL lifecycle.
- Popup-blocked fallback and non-authoritative print wording.
- No regression to current PNG/PDF and thermal print actions.

### 14.4 Browser acceptance tests

- Open the sheet panel and select a preset.
- Preview A4 and Letter with correct aspect ratio and slot count.
- Select a partially used starting slot.
- Export one and multiple pages.
- Export CSV records in deterministic order.
- Inspect the produced PDF MediaBox for exact paper size.
- Reload and restore only permitted preferences.
- Continue working offline.

### 14.5 Manual physical qualification

For each qualified combination:

1. Print the representative alignment fixture at Actual size / 100%.
2. Measure horizontal and vertical registration at the first, middle, and last
   slots.
3. Record printer model, driver, operating system, browser, paper product,
   print-dialog settings, measured registration error, date, and result.
4. Print a second page after a cold reload to reveal feed drift.
5. Mark the combination qualified only when every label remains inside its
   die-cut boundary at the documented tolerance.

Generic presets may ship without claiming physical qualification. Branded
presets need verified dimensions; qualification is a separate statement about
printer and feed behaviour.

## 15. Implementation sequence

These feature phases are subordinate to the architecture gates stated at the
top of this document. Phase 0 may run concurrently as preparation; Phase 1
cannot begin until architecture Phases 0–3 pass, and Phase 3 editor work cannot
begin until architecture Phases 0–5 pass.

### Phase 0 — contract fixtures and limits

1. Add A4, Letter, grid, irregular-slot, mismatch, and two-page fixtures.
2. Benchmark full-page monochrome rasters and packed pages at 300 DPI in native
   and browser WASM builds.
3. Define documented maximum paper size, slots, pages, items, pixels, and PDF
   bytes.
4. Record the structured error-code vocabulary.

Exit condition: fixtures and limits are reviewed before the public API is
implemented.

### Phase 1 — Rust geometry and imposition

1. Add `sheet.rs`, typed input structures, `SheetError`, and validation.
2. Implement deterministic grid expansion and slot ordering.
3. Add checked raster allocation/blitting primitives.
4. Implement lightweight page planning, explicit-DPI label rendering,
   imposition, bounded PDF construction, and exact-size PDF export.
5. Add coarse `tracing` spans without subscriber initialization.
6. Add unit, golden, deterministic, and allocation-limit tests.

Exit condition: Rust produces exact A4/Letter PDFs for copies and heterogeneous
materialized documents with no editor code involved.

### Phase 2 — WASM contract

1. Add structured sheet request/response wire types.
2. Expose lightweight `planSheet` and document-bearing `buildSheetPdf`.
3. Map typed Rust errors to stable JavaScript error codes.
4. Update generated TypeScript declarations and package build scripts.
5. Extend Node/browser equivalence tests.

Exit condition: the same fixture returns the same placement plan and PDF
semantics in native Rust, Node WASM, and headless Chromium.

### Phase 2.5 — SDK landing and editor pin

1. Merge the verified `mb-printer-sdk` change to the SDK repository’s `main`.
2. Record the merged SDK commit and regenerate its release/build evidence as
   required by that repository.
3. In `mb-label-editor`, run `npm run sdk:pin -- <sha>` with that merged commit.
4. Verify the editor CI checkout builds the generated WASM package from the new
   pin before starting UI integration.
5. Add the equivalent merged-commit SDK pin to `mb-printer-cli`, update its CI
   and release checkout, migrate its existing sheet flags to core, and retain a
   compatibility test for the command surface.

Exit condition: the editor is pinned to an SDK commit available from `main`;
the two repositories do not depend on an unmerged sibling worktree.

### Phase 3 — editor domain and catalogue

1. Add sheet types, catalogue validation, normalization, and job materializer.
2. Add generic A4/Letter presets and custom grid support.
3. Extend versioned browser-local preferences with the last selected preset and
   optional last custom grid.
4. Add unit tests for conversion, presets, persistence, and record ordering.

Exit condition: the package can build a validated sheet request without UI.

### Phase 4 — sheet UI and output

1. Implement `SheetPanel` and full-sheet geometry preview.
2. Add the Print-menu entry without altering thermal route selection.
3. Integrate current-label copies and CSV records.
4. Add PDF download and print-dialog convenience actions.
5. Add a bounded busy state, safe error messages, and print-at-100% guidance.
6. Add component and browser acceptance tests.

Exit condition: an offline user can design one label, place copies or CSV
records on a partially used A4/Letter sheet, and obtain an exact-size PDF.

### Phase 5 — qualification and documentation

1. Add user-guide instructions with screenshots or diagrams as appropriate.
2. Document known browser print-dialog limitations.
3. Produce a physical qualification template and representative alignment
   fixture; defer saved calibration offsets and calibration UI.
4. Test representative inkjet and laser printers without turning individual
   results into unsupported universal claims.
5. Document the source-verification rule for adding product-code presets in a
   later release; ship only the selected generic grids in this release.

Exit condition: the feature has reproducible software evidence and clearly
scoped physical evidence.

## 16. Expected file changes

```text
mb-printer-sdk/
  Cargo.toml
  crates/mb-printer-core/Cargo.toml
  crates/mb-printer-core/src/lib.rs
  crates/mb-printer-core/src/export.rs
  crates/mb-printer-core/src/raster.rs
  crates/mb-printer-core/src/sheet.rs
  crates/mb-printer-core/tests/sheet.rs
  crates/mb-printer-wasm/src/lib.rs
  crates/mb-printer-wasm/browser-equivalence.html
  crates/mb-printer-wasm/wasm-node-equivalence.cjs
  fixtures/sheet/*

mb-label-editor/
  .github/sdk-ref
  packages/label-editor/assets/sheet-layouts.json
  packages/label-editor/src/index.ts
  packages/label-editor/src/lib/print/types.ts
  packages/label-editor/src/lib/sheets/catalogue.ts
  packages/label-editor/src/lib/sheets/job.ts
  packages/label-editor/src/lib/sheets/normalize.ts
  packages/label-editor/src/lib/sheets/types.ts
  packages/label-editor/src/lib/components/SheetPanel.svelte
  packages/label-editor/src/lib/persistence/database.ts
  packages/label-editor/tests/sheet*.test.ts
  apps/pwa/src/App.svelte
  apps/pwa/src/sdk.ts
  tests/browser/editor.spec.ts
  docs/user-guide.md

mb-printer-cli/
  .github/sdk-ref
  scripts/pin-sdk.*
  src/main.rs
  src/raster.rs
  tests/commands.rs
  CI and release workflows
```

Exact test-file splitting may follow existing repository conventions. Avoid
unrelated formatting or interface renames while implementing the feature.

## 17. Verification commands

Run from the relevant repository roots:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace

npm test
npm run check
npm run build
npm run test:browser
```

Also run the existing WASM build/equivalence workflow used by CI and inspect at
least one generated PDF with a parser that reports its MediaBox. Do not rely on
visual browser preview alone for physical-size verification.

## 18. Acceptance criteria

The first release is complete when:

- canonical v4 label files and existing thermal workflows remain compatible;
- a user edits one label independently from sheet paper;
- built-in A4 and Letter layouts normalize to exact integer micrometres;
- custom grids reject invalid, outside, overlapping, or excessive geometry;
- label size must exactly match the selected slot;
- partial first sheets and subsequent full sheets place every item exactly
  once in deterministic order;
- CSV records use the existing deterministic materialization semantics;
- exported PDF page dimensions exactly match selected paper dimensions;
- first-release editor output is consistently rendered at 300 DPI while the CLI
  retains its explicit DPI contract;
- the existing CLI sheet command uses the same Rust core planner/exporter;
- output is deterministic for identical input and limits prevent unreasonable
  browser allocations;
- errors are typed in Rust and structured at the JavaScript boundary;
- Rust emits bounded tracing spans, and the PWA diagnostics callback reports
  timing and error codes, without label or customer content;
- the browser never claims that physical printing completed;
- the UI gives explicit Actual size / 100% instructions; and
- Rust format, Clippy, workspace tests, editor checks, builds, and browser tests
  pass.

## 19. Open decisions before implementation

Resolve these during Phase 0 without changing the architecture above:

1. The exact numeric limits for paper size, slots, pages, items, pixels, and
   output bytes after the 300 DPI benchmarks.
2. The exact small set of generic grids worth shipping initially.
3. Whether the browser convenience action opens a new tab or a dedicated print
   frame after cross-browser testing.
4. The physical registration tolerance used for qualification; this must be a
   measured product decision, not a renderer guess.

These choices affect catalogue breadth and user experience, not the separation
between canonical labels, sheet layout, deterministic Rust imposition, and
host-owned printing.
