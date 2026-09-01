# Continuous-roll label support plan

## 1. Goal

Upgrade continuous media from the current fixed-size rectangle model into a
complete roll-label workflow supporting:

- fixed or content-fitted cut length;
- printer-detected roll width and length limits;
- clear roll and cut-line visualization;
- current-label and variable-length batch printing;
- explicit feed and cutter behavior;
- canonical v4 JSON compatibility; and
- equivalent behavior across direct, local-service, and cloud printing.

A continuous label must always be resolved to a finite width and height before
rendering, exporting, or printing.

### 1.1 Implementation status (2026-09-01)

The software work in Phases 1 through 4 is implemented across the editor,
printer SDK, local printer service, and cloud print service. Automated unit,
schema, contract, browser, process, packaging, and installable-PWA checks pass.
Phase 5 polish and operator documentation are also present. Hardware sign-off
is not a release or completion gate for this single-developer project.

## 2. Baseline behavior before this implementation

Before this work, the editor represented continuous stock with
`media.shape === "continuous"`. The document still has a finite width and
height:

- width is the installed roll or tape width;
- height is the length printed and cut for one label;
- continuous printer presets report a zero stock height, so selecting one
  preserves the document's existing height;
- canonical v4 serialization emits a rectangular media shape with
  `continuous: true`; and
- printer planning receives the document's finite height.

The baseline editor did not provide content-fitted length, a roll-specific
canvas, feed and cutter controls, or a true multi-document printer job.

### 2.1 Terminology and coordinate invariants

Use these terms consistently throughout the implementation:

- **Authored canvas length** is the finite `media.height` currently visible in
  the editor. In fixed mode it is also the requested cut length. In fit-content
  mode it is the resolved preview length for the current record.
- **Resolved media length** is the finite canonical `media.height` sent to a
  renderer, exporter, or print route.
- **Printable bounds** are the portion of that finite media length available to
  artwork after preserving the printer's non-printable top and bottom insets.
- **Required protocol feed** is transport behavior imposed by printer firmware
  or the SDK. It is not part of the label document and is not user editable.
- **Extra operator feed** is an optional print-job preference added beyond the
  SDK-required feed.
- **Physical roll consumption** is resolved media length plus protocol-required
  inter-label feed and any extra operator feed. The SDK must report required
  feed before the editor can present an exact estimate.

For continuous media, canonical X is always across the roll and canonical Y is
always the feed direction. `media.width` is therefore the cross-roll width and
`media.height` is the feed/cut length. `media.orientation` may affect artwork or
renderer presentation, but it must not swap these axes during continuous-length
resolution. The editor and printer SDK must share this invariant.

## 3. Product behavior

### 3.1 Length modes

Add two continuous-media length modes.

1. **Fixed length**
   - The user enters an exact cut length.
   - This is equivalent to the existing behavior.
2. **Fit content**
   - The editor calculates the cut length from visible content.
   - Length is recalculated after element edits and template materialization.
   - Each batch record may have a different length.

### 3.2 Fit-content calculation

Use this initial calculation:

```text
contentBottom = maximum physical bottom edge of visible leaf elements
naturalLength = contentBottom + trailingMargin
resolvedLength = max(naturalLength, effectiveMinimumLength)

if naturalLength > effectiveMaximumLength:
  return continuous.content_exceeds_maximum
```

Rules:

- Ignore hidden elements.
- Ignore group containers and measure their visible descendants.
- Include the axis-aligned physical bounds of rotated elements.
- Include half the stroke width for shapes and lines.
- Resolve zone-local elements into label coordinates before measuring.
- Preserve each element's authored Y position; do not silently move artwork.
- Show the leading safe margin as a guide and warn when content crosses it.
- Resolve an empty label to its minimum length.
- Never clamp content downward to the maximum; doing so would silently clip it.
- Reject output when natural length exceeds the effective maximum length.

Preserving authored coordinates avoids unexpected layout changes while the user
edits. The leading margin is therefore a safe-area inset, while the trailing
margin contributes directly to the calculated cut length.

## 4. Internal data model

Add editor-only continuous-media configuration:

```ts
export interface ContinuousMediaSettingsV1 {
  version: 1;
  lengthMode: 'fixed' | 'fit-content';
  fixedLengthMm: number;
  leadingMarginMm: number;
  trailingMarginMm: number;
  preferredMinimumLengthMm?: number;
  preferredMaximumLengthMm?: number;
  batchLengthMode: 'per-record' | 'uniform-longest';
}

export interface Media {
  // Existing fields remain unchanged.
  continuousSettings?: ContinuousMediaSettingsV1;
}
```

Printer limits are hard capability limits. Document values are preferences that
may narrow, but never widen, those limits:

```text
effectiveMinimum = max(printerMinimum, preferredMinimum ?? printerMinimum)
effectiveMaximum = min(printerMaximum, preferredMaximum ?? printerMaximum)
```

Return `continuous.invalid_length_range` if effective minimum exceeds effective
maximum.

`ContinuousMediaLimits` must record its source (`printer` or `generic-export`).
When no destination printer is selected, use explicit editor safety limits for
preview and file export rather than pretending a printer limit is known. Mark
the result as not printer-qualified and validate it again against the selected
printer before printing. Generic limits must be constants covered by tests, not
implicit `Infinity` values.

`fixedLengthMm` is authoritative in fixed mode. Every explicit fixed-length edit
must update both `fixedLengthMm` and `media.height` atomically. In fit-content
mode, `media.height` is the current record's derived preview length and
`fixedLengthMm` is retained only for a future switch back to fixed mode.

Defaults for an existing continuous document:

```ts
{
  version: 1,
  lengthMode: 'fixed',
  fixedLengthMm: document.media.height,
  leadingMarginMm: 2,
  trailingMarginMm: 2,
  batchLengthMode: 'per-record'
}
```

For non-continuous labels, retain the settings so switching media types does
not erase the user's configuration, but do not apply them.

### 4.1 Canonical v4 compatibility

Do not add `continuousSettings` directly to canonical `media`; the strict SDK
schema may reject unknown media properties.

Instead:

- continue exporting `media.continuous: true`;
- continue exporting a finite canonical `media.height`;
- store authoring settings inside `makersbrain.editor:state`;
- restore those settings in `fromSdkDocument()`; and
- export the currently resolved height in JSON files.

For a template document, the canonical height saved in `.mb-label.json`
represents `template.currentRecord`. The full template and fit-content settings
remain in editor metadata, so every other record is materialized and resolved
independently at output time. Saving a fit-content document therefore becomes an
asynchronous prepare-then-serialize operation. The synchronous serializer must
reject an unresolved fit-content document rather than guessing a height.

Update `src/lib/sdk-document.ts` and add strict round-trip compatibility tests.

## 5. Resolution service

Create `packages/label-editor/src/lib/continuous-media.ts` with this public API:

```ts
export const RESOLVED_LABEL_DOCUMENT: unique symbol;

export interface ResolutionStamp {
  sourceFingerprint: string;
  recordIndex?: number;
  layoutVersion: string;
}

export type ResolvedLabelDocument = LabelDocument & {
  readonly [RESOLVED_LABEL_DOCUMENT]: ResolutionStamp;
};

export interface ContinuousResolution {
  document: ResolvedLabelDocument;
  contentBounds?: Bounds;
  naturalLengthMm: number;
  resolvedLengthMm: number;
  warnings: ContinuousMediaWarning[];
}

export interface ContinuousMediaLimits {
  minimumLengthMm: number;
  maximumLengthMm: number;
  source: 'printer' | 'generic-export';
  printerModel?: string;
}

export function resolveContinuousDocument(
  document: LabelDocument,
  measurement: DocumentMeasurement,
  limits?: ContinuousMediaLimits,
): ContinuousResolution;
```

Supporting functions:

```ts
contentBounds(document, measurement): Bounds | undefined
continuousSettings(document): ContinuousMediaSettingsV1
validateContinuousMedia(document, limits): ContinuousMediaWarning[]
resolveContinuousBatch(documents, measurements, mode, limits): ContinuousResolution[]
```

The resolver attaches the runtime stamp as a non-enumerable symbol property.
The stamp therefore supports `isResolvedLabelDocument()` at runtime but is not
included in JSON serialization. Output-facing APIs accept
`ResolvedLabelDocument`, preventing unresolved fit-content source documents from
reaching the SDK accidentally. A `structuredClone()` intentionally loses the
stamp; code that clones a prepared document must prepare and validate the clone
again.

### 5.1 Authoritative layout measurement

Element transform rectangles alone are not sufficient for fit-content text.
Wrapping, `auto-height`, shrink-to-fit, embedded fonts, barcodes, and renderer
rounding can change physical bounds. Add an authoritative SDK layout operation:

```ts
export interface MeasuredElementBounds {
  instanceId: string;
  sourceElementId: string;
  zoneId?: string;
  bounds: Bounds;
}

export interface DocumentMeasurement {
  elements: MeasuredElementBounds[];
  contentBounds?: Bounds;
}

export interface DocumentMeasurer {
  measure(document: LabelDocument): Promise<DocumentMeasurement>;
}
```

Measurement runs after record materialization and font/resource loading. It must
use the same layout engine and rounding rules as raster rendering. Phase 1 must
add this operation to the WASM adapter before enabling fit-content. If the
authoritative measurer is unavailable, fixed mode remains usable but fit-content
must be disabled with an actionable message.

All returned bounds are axis-aligned physical bounds in canonical root-media
coordinates after zone-origin application and clone expansion. The editor
resolver must not apply zone offsets a second time.

For simple shapes the SDK may derive bounds from transforms. For rotated items
it returns axis-aligned physical bounds including stroke. Group containers are
not measured as content; their rendered leaf descendants are. The editor must
not maintain a second independent text-layout implementation. Clone expansion
uses a distinct `instanceId` while retaining `sourceElementId`, so physical
placements can be measured once each without confusing them with authoring IDs.

The resolver must clone the document and update:

- `media.height`;
- `media.printableBounds.height` while preserving non-printable insets; and
- any root-height-dependent resolved output state.

It must never mutate the editor's source document.

Preserve printable insets as follows:

```text
topInset = printableBounds.y
bottomInset = oldMediaHeight - printableBounds.y - printableBounds.height
newPrintableHeight = resolvedMediaHeight - topInset - bottomInset
```

Reject the result if `newPrintableHeight <= 0`. Do not reset printable X, Y,
width, or hardware margins during resolution. Also reject a negative source
bottom inset; it indicates an already-invalid document rather than a margin that
can safely be preserved.

### 5.2 Zone policy

Zones are layout containers, not printable content by themselves:

- Empty zone bounds do not increase fit-content length.
- The authoritative measurer translates a zone-local element by its zone origin
  before returning root-media bounds.
- Elements expanded into cloned zones are measured at every physical clone
  placement; the source authoring element is not counted twice at its source.
- A zone extending beyond the cut line is allowed when no visible content uses
  that area.
- Visible zone content beyond the effective maximum produces the same hard
  overflow error as root content.
- Zone-batch pages are materialized first and then measured and resolved page by
  page. `uniform-longest` is applied only after every materialized page has a
  natural length.
- Missing, cyclic, or invalid clone-zone references are resolution errors.

### 5.3 Batch modes

`per-record` allows different physical lengths:

```text
Record A -> 28 mm
Record B -> 44 mm
Record C -> 31 mm
```

`uniform-longest` resolves every record to the longest result:

```text
All records -> 44 mm
```

Uniform mode supports workflows that require consistent physical labels.

## 6. Media interface

Update `src/lib/components/MediaPanel.svelte`.

When shape is `continuous`, show:

- roll width;
- length mode: Fixed or Fit content;
- fixed cut length when applicable;
- leading safe margin;
- trailing margin;
- preferred minimum length;
- preferred maximum length;
- batch sizing: Per record or Match longest;
- current calculated length;
- printer-supported range; and
- a reset-to-printer-defaults action.

Rename generic fields contextually:

- `Width` becomes `Roll width`;
- `Height` becomes `Cut length` in fixed mode.

When printer stock is selected:

- set the roll width;
- preserve the user's current fixed or calculated cut length;
- apply printer minimum and maximum lengths; and
- do not convert a fit-content document back to fixed mode.

Label the editable limits as **Preferred minimum** and **Preferred maximum**.
Show printer limits separately as read-only hard limits. The UI must prevent a
preference from widening the selected printer's supported range.

## 7. Canvas behavior

Update `src/lib/components/Canvas.svelte`.

### 7.1 Visual representation

For continuous media:

- display the printable label through the calculated cut line;
- draw a distinct dashed cut line;
- show a `Cut at 42 mm` marker;
- show a faded roll continuation below the cut line;
- show the leading safe-margin guide;
- show the trailing-margin region; and
- update the calculated cut line while elements move or resize.

Conceptually:

```text
+--------------------------+
| leading safe margin      |
|                          |
| label content            |
|                          |
| trailing margin          |
+ - - Cut at 42 mm - - - - +
| faded roll continuation  |
|            :             |
```

### 7.2 Editing rules

- Elements remain editable in millimetre coordinates.
- Moving content downward expands fit-content labels.
- Moving content upward reduces their length, subject to the minimum.
- Fixed-length labels do not expand automatically.
- Fixed mode warns when content extends past the cut line.
- Fit mode shows a blocking error when content exceeds the effective maximum.
- Calculated preview height is derived state and does not create undo history.
- Only explicit changes to continuous-media settings create commands.

## 8. Output pipeline

Enforce this invariant:

> No renderer, exporter, or print route receives an unresolved continuous
> document.

Create an output preparation helper:

```ts
async function prepareDocumentForOutput(
  document: LabelDocument,
  materializer: DocumentMaterializer,
  measurer: DocumentMeasurer,
  options?: {
    record?: Record<string, string>;
    limits?: ContinuousMediaLimits;
  },
): Promise<ResolvedLabelDocument>;
```

Preparation order:

1. Select the explicit record or `template.currentRecord`.
2. Materialize template values and dynamic layout inputs.
3. Measure final layout through the authoritative SDK measurer.
4. Resolve continuous length without downward maximum clamping.
5. Validate printer and preferred limits.
6. Return a finite branded clone.
7. Render, export, or print the clone.

Fixed non-continuous and fixed-length continuous documents still pass through
the helper so printable bounds and capability validation remain centralized.
They may be branded without invoking measurement when their transforms are
already authoritative and no dynamic auto-height content is present.

Apply this to:

- thermal preview;
- PNG export;
- PDF export;
- JSON export and save;
- current-label printing;
- batch PDF;
- batch printing;
- sheet PDF when continuous labels are intentionally placed on sheets;
- direct printing;
- local-service printing; and
- cloud printing.

Routes should also defensively reject invalid continuous documents.

`serializeDocument()` remains synchronous for fixed and already resolved
documents. Add an explicit asynchronous PWA/package workflow for fit-content
save and JSON export:

```ts
const resolved = await prepareDocumentForOutput(
  document,
  materializer,
  measurer,
  { record: currentRecord },
);
await saveDocument(resolved);
```

Runtime serialization returns `continuous.unresolved_document` when fit-content
metadata is present but the canonical height has not been prepared. This same
guard is applied before direct, local-service, and cloud serialization.

## 9. Template and batch integration

Update `src/lib/components/BatchPanel.svelte`.

For each record:

1. Materialize template values.
2. Resolve text, fonts, and auto-height behavior through the SDK layout engine.
3. Measure final element bounds through `DocumentMeasurer`.
4. Resolve cut length.
5. Validate printer limits.

Add a summary table:

| Record | Length | Status |
| --- | ---: | --- |
| 1 | 28.0 mm | Ready |
| 2 | 44.5 mm | Ready |
| 3 | 102.0 mm | Exceeds 100 mm |

Also show:

- minimum length;
- maximum length;
- average length;
- estimated total roll consumption; and
- number of invalid records.

Disable printing when any record exceeds a hard printer limit.

Before Phase 3, consumption is explicitly labelled **media length only** because
mandatory protocol feed is not yet available. Once SDK feed reporting exists,
replace it with exact estimated physical consumption and show the feed
components in the breakdown.

### 9.1 Performance

- Debounce batch-length calculation.
- Cancel stale calculations with `AbortController`.
- Calculate the current preview record immediately.
- Calculate the complete batch when the batch panel opens or before output.
- Cache by document revision, record index, and continuous settings.

Do not use `modifiedAt` alone as the cache identity because multiple edits may
share a timestamp and external callers can construct documents manually. Use a
stable fingerprint of the materialized document geometry, resources/fonts that
affect layout, record values, continuous settings, and SDK layout version.

## 10. Cutter and feed settings

Cutter and feed behavior belongs to the print job, not the artwork document.

Add:

```ts
export interface ContinuousPrintOptions {
  cutMode: 'after-each' | 'after-job' | 'none';
  extraFeedBeforeMm: number;
  extraFeedAfterMm: number;
  chainCopies: boolean;
}
```

Extend `PrintRequest`:

```ts
export interface PrintRequest {
  // Existing fields remain unchanged.
  continuous?: ContinuousPrintOptions;
}
```

Show these controls only when the document is continuous and the selected
printer supports them:

- cut after every label;
- cut once after the complete job;
- do not cut;
- extra feed before printing;
- extra feed after printing; and
- chain copies without intermediate cuts.

These values are additions to mandatory feed chosen by the SDK, not total feed
distances and not artwork margins. Use zero as the safe user default and do not
expose unsupported options. The UI must display SDK-required feed separately as
read-only when that information is available.

## 11. Printer capability model

Extend `PrinterDefinition`:

```ts
interface ContinuousMediaCapabilities {
  supported: boolean;
  minimumLengthMm: number;
  maximumLengthMm: number;
  minimumExtraFeedMm: number;
  maximumExtraFeedMm: number;
  cutModes: Array<'after-each' | 'after-job' | 'none'>;
  automaticCutter: boolean;
  supportsChainedRaster: boolean;
}

interface PrinterDefinition {
  // Existing fields remain unchanged.
  continuousMedia?: ContinuousMediaCapabilities;
}
```

The printer SDK remains authoritative for:

- length range;
- required leading and trailing feed;
- cutter support;
- whether copies can share one print job;
- protocol-specific raster alignment; and
- mandatory final feed.

The editor must not guess cutter commands.

## 12. Printer SDK changes

The WASM SDK currently plans one finite document with copies. Extend its
planning options with continuous-job settings, conceptually:

```json
{
  "copies": 3,
  "continuous": {
    "cutMode": "after-each",
    "extraFeedBeforeUm": 2000,
    "extraFeedAfterUm": 3000,
    "chainCopies": true
  }
}
```

Required SDK work:

- validate continuous options against printer capabilities;
- generate protocol-specific feed commands;
- generate cutter commands only when supported;
- avoid cuts between chained copies;
- guarantee a safe final feed when required;
- calculate and report mandatory protocol feed separately from user-requested
  extra feed;
- reject continuous requests for incompatible media or printers; and
- return structured errors rather than generic planning failures.

Add golden protocol-plan tests for each supported printer family.

## 13. True batch jobs

The current batch executor submits every document as a separate print job. That
cannot reliably implement `cut after job`.

Add optional native batch support to the route contract:

```ts
export interface PrintRoute {
  // Existing fields remain unchanged.
  printBatch?(request: {
    documents: LabelDocument[];
    printer: PrinterDefinition;
    copies: number;
    continuous?: ContinuousPrintOptions;
    signal?: AbortSignal;
    onProgress?: (progress: BatchPrintProgress) => void;
  }): Promise<PrintResult>;
}
```

Rules:

- `after-job` requires native batch support.
- Disable that cut mode when the active route lacks batch support.
- Never emulate `after-job` with separate jobs.
- Preserve one idempotency snapshot for the complete batch.
- Report progress by document, copy, action, and bytes.

## 14. Local-service and cloud contracts

The local and cloud JSON contracts currently carry a document, model or
printer, copies, and density. Add optional continuous options and batch document
support through their OpenAPI specifications.

Required work:

1. Update the `mb-print-cloud` OpenAPI contract.
2. Update the local printer-service OpenAPI contract.
3. Regenerate TypeScript clients.
4. Update server-side validation.
5. Persist exact continuous options in recovery snapshots.
6. Include those options in idempotency comparisons.
7. Make old servers reject unsupported options clearly.
8. Add capability or version negotiation before enabling advanced controls.

Do not silently discard cut or feed preferences.

## 15. Persistence

### 15.1 Document authoring settings

Store these in `makersbrain.editor:state` so they travel with
`.mb-label.json`:

- length mode;
- fixed length;
- margins;
- preferred minimum and maximum limits; and
- batch length behavior.

### 15.2 Device and job preferences

Store destination-specific print preferences in browser preferences, keyed by
printer model:

```ts
continuousPrint?: Record<string, ContinuousPrintOptions>
```

Do not store cutter behavior in the label document because it depends on the
destination printer and operational workflow.

Existing documents need no database migration. Missing fields receive defaults
during decoding.

## 16. Validation and warnings

Add stable error codes:

```text
continuous.invalid_width
continuous.invalid_fixed_length
continuous.invalid_length_range
continuous.content_exceeds_maximum
continuous.content_before_leading_margin
continuous.empty_content
continuous.measurement_unavailable
continuous.unresolved_document
continuous.invalid_printable_bounds
continuous.invalid_zone
continuous.unsupported_printer
continuous.cut_mode_unsupported
continuous.feed_out_of_range
continuous.batch_route_unsupported
```

Severity levels:

- **Error:** cannot safely render or print.
- **Warning:** output is valid but may not match operator intent.
- **Information:** calculated length or estimated roll consumption.

Batch messages must identify the affected record.

## 17. Testing plan

### 17.1 Unit tests

Test the resolver with:

- an empty document;
- hidden elements;
- nested groups;
- rotated elements;
- lines and stroke widths;
- zone-local coordinates;
- cloned and cyclic zones;
- canonical Y as the feed axis under both orientation values;
- elements past the current cut line;
- minimum expansion and maximum overflow without downward clamping;
- preservation of top and bottom printable insets;
- fixed and fit-content modes;
- per-record and uniform-longest batches;
- authoritative auto-height text measurements;
- source-document immutability; and
- millimetre rounding.

### 17.2 Serialization tests

Verify that:

- existing continuous documents open in fixed mode;
- continuous settings survive JSON round trips;
- canonical `media` contains no unknown properties;
- canonical height is finite and resolved; and
- template JSON height represents `template.currentRecord`;
- unresolved fit-content serialization fails explicitly;
- non-continuous documents remain semantically compatible.

### 17.3 Component tests

Verify that:

- continuous controls appear only for continuous media;
- fixed and fit-content fields switch correctly;
- printer limits populate correctly;
- invalid settings disable output; and
- cut-line preview updates after transforms.

### 17.4 Browser tests

Cover:

- creating a continuous label;
- selecting printer-reported continuous media;
- moving an element and seeing the cut line expand;
- fixed-length overflow warnings;
- JSON save and reopen;
- PNG and PDF dimensions;
- variable-length CSV records; and
- cut-mode capability gating.

### 17.5 Contract tests

Cover direct, local, and cloud requests to ensure:

- resolved heights are identical;
- continuous options are retained;
- mandatory feed and extra operator feed are not conflated;
- recovery reuses byte-identical snapshots; and
- unsupported options fail before sending bytes.

## 18. Delivery phases

### Phase 1: Safe sizing foundation

- Add the internal continuous settings.
- Add the authoritative SDK/WASM document measurement operation and version it.
- Add the pure resolver.
- Add the branded resolved-document output boundary and runtime guards.
- Add canonical metadata round trips.
- Add Fixed and Fit-content controls.
- Add the cut-line preview.
- Convert fit-content save/export to asynchronous prepare-then-serialize.
- Resolve current-label JSON, PNG, and PDF outputs for `template.currentRecord`.
- Add unit and browser tests.

Exit condition: a user can create and export a correctly sized continuous label
without printing.

### Phase 2: Variable batch lengths

- Resolve after record materialization.
- Add per-record and uniform-longest modes.
- Add the batch length preview.
- Add roll-consumption estimates.
- Resolve batch PDF and print documents.

Exit condition: every CSV record produces a validated finite label length.

### Phase 3: Printer-aware feed and cutting

- Add the capability model.
- Extend SDK planning options.
- Integrate direct printing.
- Add cutter and feed controls.
- Add protocol golden tests.

Exit condition: direct printing reliably respects supported feed and cut modes.

### Phase 4: Local and cloud parity

- Update OpenAPI contracts.
- Regenerate clients.
- Add native batch job contracts.
- Preserve idempotency and recovery snapshots.
- Add capability and version negotiation.

Exit condition: direct, local, and cloud routes produce equivalent
continuous-roll jobs.

### Phase 5: Workflow polish

- Add operator guidance.
- Refine roll visualization.
- Add roll-consumption reporting.
- Document error recovery.

Exit condition: continuous-roll behavior is understandable and recoverable in
the editor without requiring release-time administrative sign-off.

## 19. Recommended initial pull-request sequence

Keep each pull request independently testable and avoid combining SDK contract,
serialization, canvas, and output-boundary changes in one review.

### PR 1A: Authoritative measurement contract

1. Add and version the SDK/WASM `measureDocument` contract.
2. Expose it through the browser adapter.
3. Prove that measured bounds use the same fonts, wrapping, rotation, stroke,
   zones, and rounding as rendering.
4. Add SDK golden and TypeScript adapter tests.

This PR changes no editor behavior.

### PR 1B: Resolver and compatibility foundation

1. Add `ContinuousMediaSettingsV1`.
2. Add `continuous-media.ts`, the runtime resolution stamp, and
   `ResolvedLabelDocument`.
3. Implement fixed and fit-content resolution without downward clipping.
4. Preserve printable insets and resolve zone-local and cloned content.
5. Store settings in editor metadata and add strict round-trip tests.
6. Add geometry, limits, immutability, and runtime-guard unit tests.

This PR exposes core APIs but does not route production output through them.

### PR 1C: Editor and output integration

1. Add continuous controls to the media panel.
2. Add the canvas cut line and roll continuation.
3. Add asynchronous prepare-then-serialize for JSON, PNG, and PDF outputs.
4. Resolve `template.currentRecord` for current-label outputs.
5. Add component and browser tests.

Do not include cutter protocol changes in these PRs. Sizing and canonical output
must be stable before changing physical printer behavior.

## 20. Completion criteria

Continuous-roll support is complete when:

- a roll width can be detected or selected without losing the authored length
  mode;
- fixed and fit-content labels render and export at deterministic dimensions;
- fit-content uses the same authoritative layout engine as rendering;
- continuous Y is consistently treated as the physical feed axis;
- printable insets survive every length resolution;
- template records can resolve to different validated lengths;
- oversized natural content fails instead of being clamped and clipped;
- every output route receives the same resolved canonical document;
- canonical JSON save resolves `template.currentRecord` and retains authoring
  settings for subsequent records;
- feed and cut settings are capability-gated and preserved end to end;
- mandatory SDK feed, artwork margins, and extra operator feed remain distinct;
- batch-level cutting uses a true multi-document printer job;
- interrupted jobs retain exact recovery snapshots.
