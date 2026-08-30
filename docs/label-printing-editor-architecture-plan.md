<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Label printing and editor architecture review plan

Status: implemented locally; pending merged SDK pins and physical qualification

Date: 2026-08-30

Related plan: `docs/classic-printer-label-sheets-plan.md`

## Implementation record

Verified locally on 2026-08-31:

- canonical open/save preserves fonts, field labels, zones, dither/image settings,
  constraints, and unknown extensions without relying on editor-private metadata;
- group commands, narrow patches, no-op/coalesced history, IndexedDB transaction
  completion, ordered startup, autosave disposal, batch ambiguity handling, and
  exact local idempotency recovery have regression coverage;
- the editor delegates physical browser actions to the SDK browser executor;
- Rust owns checked sheet normalization, placement, raster imposition, packed
  PDF construction, and document render-profile interpretation;
- WASM exposes the lightweight sheet plan and document-bearing PDF operations;
- the existing CLI sheet command delegates to the Rust implementation, uses an
  exact SDK pin gate, has a host tracing subscriber, and has its local job
  subsystem isolated in a focused module;
- native/CLI/cloud tracing uses bounded allowlisted lifecycle fields; and
- the full SDK/WASM, CLI, editor/PWA, cloud, release-boundary, and 27-test
  compiled-browser suites pass with the available system Chromium.

Still required before calling the architecture release complete:

- merge the SDK work, then replace editor and CLI SDK pins with that merged
  `main` commit (a correct SHA cannot be created from an uncommitted worktree);
  and
- perform and record representative physical-printer qualification separately
  from deterministic software geometry checks.

## 1. Outcome

Make one deterministic Rust implementation authoritative for every operation
that can change printed or exported output, while keeping editing interaction,
browser persistence, device selection, and presentation in TypeScript/Svelte.

The intended pipeline is:

```text
editor projection
      |
      v
canonical v4 document
      |
      v
parse -> validate -> materialize -> resolve media -> render -> export/plan
                           Rust core
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
       PNG/PDF/WASM                     protocol action plan
                                                 |
                            browser/native executor + transport
                                                 |
                                              printer
```

This is a consolidation plan, not a rewrite. Preserve the existing three-crate
SDK split, the editor command/history model, and the closed protocol enum. Fix
known correctness and safety defects before adding more output paths.

## 2. Scope

This plan covers:

- `mb-printer-sdk` core, WASM, and native crates;
- `mb-printer-cli` commands, loopback API, job execution, and SDK pinning;
- `mb-label-editor` model projection, commands, history, persistence, SDK
  adapter, batch operations, and print routes;
- the editor-to-cloud and cloud-to-agent job boundary where it affects printing
  semantics and observability; and
- classic A4/Letter label-sheet export as the first feature built after the
  common boundaries are repaired.

It does not authorize a new plugin framework, protocol trait hierarchy, event
sourcing, distributed workflow engine, silent browser printing, or migration
of ordinary UI interaction into Rust.

## 3. Review evidence and verification status

The review inspected current source in all four repositories and the existing
classic-sheet plan. No production source was changed.

Verified:

- `npm test --workspace @makersbrain/label-editor`: 63 tests passed;
- `npm run check --workspace @makersbrain/label-editor`: zero errors and zero
  warnings; and
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` in
  `mb-printer-sdk`: passed.

The full SDK all-features test run did not complete because the filesystem ran
out of space while linking. The existing `mb-printer-sdk/target` directory was
approximately 37 GB and the volume had approximately 34 MB free. Treat this as
an environment limitation, not a test failure. Do not delete those artifacts
without explicit approval; rerun the full suite after space is recovered.

## 4. Prioritized code-review findings

### 4.1 Output and document correctness

1. **Canonical open/save is not semantically lossless.**

   `packages/label-editor/src/lib/sdk-document.ts` reconstructs fonts and image
   rendering primarily from private `makersbrain.editor:state`. A canonical
   SDK document without that extension can lose `fontResource`, global dither,
   and image-render settings when opened and saved. Editor-private metadata
   must improve UX, never be required to preserve canonical print semantics.

2. **Editor group commands can produce invalid references.**

   `removeElements` may delete a group while leaving child `groupId` values;
   `duplicateElements` can duplicate a group without its subtree; grouping does
   not centrally reject duplicate parentage or cycles. The current lightweight
   editor assertion checks duplicate IDs but not graph invariants.

3. **Generic element patches can corrupt discriminated variants.**

   Exported `patchElement` and `bulkPatch` accept `Partial<LabelElement>` and
   use `Object.assign`, allowing `type`, `id`, or fields from another element
   kind to be applied at runtime.

4. **Rust semantic validation disagrees with the schema for built-in-font
   text.**

   `Document::validate` checks positive `font_size` only when `font_resource`
   is present. Built-in-font text can therefore carry a zero or negative size,
   after which rendering silently clamps it. Semantic and schema validation
   must agree.

5. **Render policy is duplicated across hosts.**

   WASM interprets `makersbrain.render:dither`; CLI rendering has separate
   defaults and overrides; the local API and CLI main each apply printer
   fitting/rotation policy. The same document can therefore render differently
   depending on entrypoint.

### 4.2 Resource safety and bounded memory

6. **Limits are applied after expensive resource allocation.**

   Image decode converts to grayscale before checking pixels. SVG parse/tree
   complexity is not bounded before raster checks. Document validation decodes
   and hashes every resource without document/resource byte limits, and render
   decodes resources again.

7. **External geometry arithmetic can overflow or allocate unchecked.**

   Media/zone containment and render placement add untrusted signed integers
   directly. Raster constructors multiply dimensions with unchecked casts,
   especially dangerous on wasm32.

8. **Batch PDF and PDF normalization retain excessive data.**

   WASM batch export retains every byte-per-pixel raster. PDF normalization
   limits per-page pixels but not input bytes, page count, or total pixels, then
   serializes grayscale pixels as JSON arrays with additional copies.

9. **Protocol copy expansion can allocate up to 65,535 full action sequences.**

   Non-TSPL planning clones action and raster payloads once per requested copy.
   A conservative copy/action/owned-byte cap is required before considering a
   structural repeat representation.

10. **The hand-written base64 decoder is unnecessarily permissive.**

    Core already depends on `base64`; resource validation should use the
    standard engine, typed decode errors, and decoded-length estimation.

### 4.3 Browser, native, and service execution

11. **Two browser plan executors already disagree about pacing.**

    `mb-printer-wasm/browser-adapters.ts` delays after every physical transport
    fragment, matching `delay_after_each_physical_write_ms`.
    `mb-label-editor/src/lib/print/direct.ts` delays once per logical chunk.
    They also duplicate atomic-write, response, cancellation, and ambiguous
    outcome behavior.

12. **Local editor job recovery loses idempotency on an ambiguous POST.**

    The local route creates an idempotency key inside `submit` and journals only
    after receiving a remote job. If submission fails after acceptance, the
    exact body/key pair is unavailable for safe recovery. Its polling loop also
    ignores the request signal and does not use the existing cancel endpoint.

13. **The CLI already contains a competing sheet implementation.**

    `mb-printer-cli/src/raster.rs::sheet_pdf` implements A4-only float geometry,
    unchecked full-page allocation, repeated-label grids, and cut marks. A new
    Rust core sheet implementation must migrate this command rather than leave
    two authorities.

14. **CLI releases use an unpinned sibling SDK checkout.**

    The editor has `.github/sdk-ref`; CLI path dependencies and workflows use a
    moving SDK checkout. A cross-repository core change is not reproducible
    until CLI adopts the same merged-commit pin and ancestry gate.

15. **Local API and PWA boundary modules are oversized.**

    `mb-printer-cli/src/api.rs` is roughly 3,000 lines and combines auth,
    connection discovery, document operations, jobs, persistence, and La Poste.
    `apps/pwa/src/App.svelte` combines bootstrap, persistence, credentials,
    routes, export, recovery, theme, and status. Split cohesive responsibilities
    without adding a dependency-injection framework.

### 4.4 Persistence and application state

16. **IndexedDB request ordering is unsafe.**

    `EditorDatabase.entries()` awaits `getAllKeys()` before issuing `getAll()`
    on the same transaction; real browsers may auto-commit it. Writes resolve
    on request success instead of transaction completion, missing late aborts.

17. **Startup persistence races the temporary default document.**

    Autosave recovery, preference restoration, and immediate store subscription
    start independently. The initial subscription can schedule persistence for
    the temporary default document before recovery completes. Autosave has no
    flush, dispose, or error callback.

18. **History records no-op and high-frequency edits separately.**

    Every command updates `modifiedAt` and consumes one entry. Range controls
    and repeated nudges can quickly evict useful history.

19. **Batch operations bypass single-print safety controls.**

    Batch printing lacks a shared busy guard, aggregate progress, abort signal,
    exception mapping, and one stop-on-ambiguous-outcome controller.

### 4.5 Errors and observability

20. **Typed errors are flattened too early.**

    Core joins validation errors into strings, WASM returns strings, the local
    API exposes static string messages, and the PWA uses one mutable status
    string for progress, success, warning, and failure. Reliable branching and
    safe diagnostics are difficult.

21. **Tracing is absent from the physical print host and sparse in cloud.**

    Core/native libraries have no tracing facade; CLI has no subscriber; cloud
    logs startup and a few internal failures but not correlated job lifecycle.
    Physical execution occurs in `spawn_blocking`, so its span must be
    explicitly propagated.

22. **Native error display can expose raw printer responses.**

    `ExecuteError` includes debug-formatted `Progress`, which contains response
    frames. Never record its `Display` value directly in telemetry.

## 5. Target ownership

| Concern | Authoritative owner | Boundary responsibility |
|---|---|---|
| Canonical v4 parse and validation | `mb-printer-core` | Hosts pass bytes/value and consume typed results |
| Physical units, rounding, geometry | `mb-printer-core` | UI displays millimetres; wire uses integer micrometres |
| Render profile and extensions | `mb-printer-core` | Editor preserves settings; hosts may pass typed override |
| Template evaluation/materialization | `mb-printer-core` | Editor parses CSV and chooses records |
| Zones and output batch placement | `mb-printer-core` | Editor presents preview/options |
| Sheet planning/imposition/PDF | `mb-printer-core` | WASM is thin; Svelte owns form and preview presentation |
| Printer/media resolution | `mb-printer-core` | Host supplies selected model/connection |
| Protocol planning/status decoding | `mb-printer-core` | Executor performs actions only |
| Transport execution | SDK browser adapter or `mb-printer-native` | Routes journal and map progress/outcomes |
| Selection, snapping, guides, history | `mb-label-editor` TypeScript | Never move interactive state into Rust |
| IndexedDB and browser credentials | `mb-label-editor` TypeScript | Rust never sees tokens/preferences |
| UI and accessibility | Svelte | Components do not implement canonical algorithms |
| Local job persistence/auth/API | `mb-printer-cli` | Core remains side-effect free |
| Cloud queue and agent delivery | `mb-print-cloud`/agent | Cloud does not reinterpret document rendering |

Temporary duplicated algorithms may exist only behind an explicit parity test
and removal milestone.

## 6. Rust design rules

### 6.1 Crate boundaries

Preserve:

- `mb-printer-core`: deterministic, synchronous, platform-neutral domain logic;
- `mb-printer-wasm`: parse/serialize/binary bridge only; and
- `mb-printer-native`: transport side effects and plan execution.

Do not add browser types to core, install a tracing subscriber in a library, or
make core async. The existing `match Protocol` strategy is appropriate for a
closed supported protocol set; extract private protocol helpers as files become
difficult to navigate, but do not introduce dynamic dispatch.

### 6.2 Errors

- Use `thiserror` for reusable library errors.
- Use `anyhow` only in binaries/application startup where errors are reported
  and terminated, not in reusable contracts.
- Preserve typed sources until the host boundary.
- Replace `RenderError::Validation(String)` with a structured validation source.
- Replace `Resource::decoded_bytes() -> Option<_>` with a typed result.
- Give public domain errors a stable `code() -> &'static str`.
- At item loops, attach only bounded context such as item/page/action index:
  `SheetError::Render { item, source }`.
- Do not derive `Eq` for error enums that wrap non-`Eq` sources.
- Do not use `unwrap`, `expect`, saturating arithmetic, or lossy casts on
  external input.

### 6.3 Limits and checked construction

Separate limits that must run before parsing from limits enforced by typed core
operations:

```rust
pub struct WireLimits {
    pub max_input_bytes: usize,
    pub max_request_documents: u32,
}

pub struct ProcessingLimits {
    pub max_elements: usize,
    pub max_resources: usize,
    pub max_resource_bytes: usize,
    pub max_decoded_resource_bytes: usize,
    pub max_resource_pixels: u64,
    pub max_canvas_pixels: u64,
    pub max_total_pixels: u64,
    pub max_pages: u32,
    pub max_copies: u16,
    pub max_plan_actions: usize,
    pub max_plan_bytes: usize,
    pub max_output_bytes: usize,
}
```

WASM, HTTP, and CLI boundaries enforce `WireLimits` against encoded bytes and
request counts before JSON, SVG, image, or PDF parsing. Core operations enforce
`ProcessingLimits` after deserialization. A host may construct both from one
configuration profile, but core must not claim to enforce the size of source
bytes it never receives. Use operation-specific defaults constructed by the
host; do not use mutable global limits. The first implementation may use one
conservative profile shared by CLI and WASM.

Add:

- checked `try_new` constructors for gray, mono, and packed rasters;
- checked stride/length helpers;
- checked micrometre-to-dot conversion;
- `checked_add` containment for bounds/zones/transforms;
- image decoder limits before decode;
- encoded and estimated-decoded resource checks before allocation;
- SVG/PDF input-byte, page-count, and total-pixel limits;
- plan copy/action/owned-byte limits; and
- conservative output-size estimates plus bounded writers that reject an append
  before `max_output_bytes` is exceeded.

Treat encoded-byte and output-pixel limits as the MVP bound for SVG parsing.
Where the selected SVG library exposes post-parse node or path-segment counts,
cap those too. Otherwise record compact pathological SVG CPU/tree complexity as
a residual risk rather than claiming it is eliminated before parsing.

Keep byte-per-pixel `MonoRaster` for drawing simplicity. Add validated
`PackedMonoRaster { width, height, stride, bytes }` for protocol payloads, PDF
pages, and multi-page retention.

### 6.4 Render policy

Add one core operation:

```rust
pub fn render_profile_for_document(
    document: &Document,
    override_: Option<RenderOverride>,
) -> Result<RenderProfile, RenderProfileError>;
```

All PNG, PDF, protocol, CLI, local API, WASM, and sheet paths use it. Unknown or
malformed extension behavior must be explicit. An explicit CLI/UI override may
replace a setting, but default behavior never varies by host.

Move printer preparation into one data-driven core step:

```text
validate document -> resolve printer/media -> render -> rotate/fit -> plan
```

Remove hard-coded Brother 62 × 29 handling as media definitions gain the
required printable geometry. Validate printer definitions and bundled data once
before use.

### 6.5 Document indexing

First bound document counts. Only then, if profiling or code clarity warrants
it, add a private validated index of element/resource/group IDs for one
validation/render operation. Do not expose a graph framework in the public API.

## 7. Canonical editor projection

The editor may keep its ergonomic millimetre model, names, UI font choices, and
history IDs. Its canonical adapter must be semantically lossless.

### 7.1 Required rules

- Preserve canonical `fontResource` directly, even without editor metadata.
- Add an optional explicit font resource ID to the editor text projection; use
  family/weight lookup only for newly authored text.
- Preserve canonical global render profile and per-image render settings.
- Preserve zones, fields, resources, and unknown allowed namespaced extensions.
- Treat `makersbrain.editor:state` only as UI metadata.
- Never infer a new canonical render setting merely because private metadata is
  absent.
- Validate unmodified canonical input in Rust before projection.
- Validate the re-encoded canonical document in Rust before save, export, or
  print.

Prefer generated/schema-projected wire types over a handwritten second
`SdkDocument` definition. Generation remains deterministic and checked in CI.

### 7.2 Editor invariants

Define one inexpensive TypeScript invariant checker for development/tests:

- IDs are non-empty and unique;
- every resource and font reference resolves;
- every `groupId` resolves to a group;
- group `childIds` and child `groupId` agree;
- groups are acyclic and children have at most one parent;
- element geometry is finite and positive; and
- zones referenced by constraints exist.

Mutation semantics:

- deleting a group ungroups its children;
- duplicating a group duplicates its complete subtree with deterministic ID
  remapping;
- grouping rejects already-parented or cyclic selections;
- generic patching cannot change `id` or `type`; and
- exported commands are variant-specific (`setText`, `setImageRendering`,
  `setBarcodeData`, `setTransform`, and similar).

Run the inexpensive checker after commands in development/test builds, not an
async WASM validation during every pointer move.

### 7.3 History

Keep snapshot-based bounded history. Add only:

- no-op detection so unchanged commands do not consume history;
- a simple optional coalescing key for range edits and keyboard nudges; and
- tests for undo/redo across group subtree operations.

Do not introduce event sourcing.

## 8. WASM contract

WASM functions should follow the same shape:

```text
decode bounded input -> invoke one core operation -> encode result
```

They must not contain render policy, printer-specific geometry, batch planning,
or transport execution.

### 8.1 Ports

Avoid growing the already broad editor `PrinterSdk` interface. Introduce small
ports and compose them in the PWA adapter:

```ts
interface DocumentEngine { validate; render; exportPng; exportPdf; importPdf; }
interface MaterializationEngine { materializeRecord; planZoneBatch; }
interface PrinterEngine { definitions; media; plan; statusPlan; parseStatus; }
interface SheetExporter { planSheet; exportSheetPdf; }
interface PostalEngine { inspectLaPoste; laPosteSlotDocument; }
```

Components accept the narrowest port they use. Compatibility aliases may keep
the existing public `PrinterSdk` type during migration.

### 8.2 Errors

Define one versioned safe wire error:

```ts
interface SdkWireError {
  version: 1;
  code: string;
  message: string;
  details?: { item?: number; page?: number; action?: number; field?: string };
}
```

Details are a closed, bounded schema. Never include serialized documents,
element values, IDs supplied by users, resources, paths, endpoints, tokens,
certificates, or raw printer frames. Provide one TypeScript type guard and an
unknown-error fallback. Contract fixtures cover every exported error code.

### 8.3 Binary boundaries

- Stop returning large grayscale pages as JSON number arrays.
- Prefer `Uint8Array` plus a small typed metadata object, or packed page data.
- Bound serialized document arrays before deserializing every item.
- Cap pages and total pixels for PDF normalization.
- Keep native/WASM equivalence fixtures mandatory in release CI.

## 9. Browser and native execution

### 9.1 One browser executor

Make `@makersbrain/printer-sdk/adapters.executePlan` the only browser protocol
executor. Adapt editor WebUSB/WebBluetooth/WebSerial transports to its transport
interface. `DirectPrintRoute` retains only:

- connection selection;
- job journal creation/update;
- safe progress mapping;
- cancellation intent; and
- final outcome mapping.

Freeze one cross-target execution fixture covering atomic write limits,
physical-fragment pacing, response timeout/fallback, cancellation before/after
write, and ambiguous disconnect. Native and browser executors must produce the
same logical events for that fixture.

### 9.2 Local route recovery

Mirror the cloud route’s safe submission pattern with `LocalJobDetails`:

```ts
interface LocalJobDetails {
  kind: 'local-print';
  idempotencyKey: string;
  serializedRequest: string;
  connectionId: string;
  printerModel: string;
  remoteJobId?: string;
}
```

Persist this snapshot before POST. On uncertain submission, retry only the exact
body/key pair. Pass `AbortSignal` through GET and delay operations. Treat these
as distinct actions:

- **Stop watching**: stop local polling; remote outcome remains unknown.
- **Cancel print job**: POST cancel, then observe the authoritative terminal
  state.

Never report cancellation as “not printed” after a potentially accepted write.

### 9.3 Batch controller

Add one library-level `executeBatch` using `PrintRoute` with a busy guard,
`AbortSignal`, aggregate progress, exception mapping, and stop-on-ambiguous
outcome. Svelte panels collect options and display state only. Do not add a
general workflow engine.

## 10. Persistence and editor sessions

Fix IndexedDB primitives first:

- issue all requests synchronously before awaiting, or use one cursor;
- resolve writes on transaction completion;
- reject on transaction abort/error; and
- test inactive transactions and late write aborts.

Add three small application controllers:

```text
EditorSession   document bootstrap, recovery, autosave, library repository
PrinterSession  SDK loading, selected model, selected route/connection
OperationStatus one discriminated operation/progress/error state
```

Bootstrap order:

```text
open database -> load preferences -> choose autosave recovery -> create store
-> attach persistence -> render application
```

Autosave exposes `schedule`, `flush`, and `dispose`, and reports quota/storage
errors through `OperationStatus`. Inject repository interfaces into panels;
panels must not construct hidden `EditorDatabase` instances.

Use a discriminated state rather than one string:

```ts
type OperationState =
  | { state: 'idle' }
  | { state: 'running'; operation: string; progress?: PrintProgress }
  | { state: 'succeeded'; operation: string; message: string }
  | { state: 'failed'; operation: string; code: string; message: string };
```

## 11. CLI and local API structure

### 11.1 CLI rendering and sheet compatibility

Replace CLI rendering policy with core operations. Preserve existing sheet CLI
flags through a compatibility adapter:

```text
old flags -> SheetGrid/SheetOptions -> mb_printer_core::sheet
```

Decide cut marks explicitly:

- keep them as an opt-in CLI overlay if compatibility requires them; or
- deprecate the flag with a release note.

Do not add cut marks to commercial label-sheet presets by default. Delete
`raster::sheet_pdf` after parity/compatibility tests pass.

### 11.2 API module split

Split `api.rs` by route ownership while retaining one `ApiState`, one router,
and ordinary Axum handlers:

```text
api/mod.rs          state, router, common response/error
api/grants.rs       pairing and grant lifecycle
api/connections.rs  discovery, probing, persisted connections/status
api/documents.rs    validate, preview, export
api/jobs.rs         submit, status, events, cancel, execution
api/laposte.rs      extraction endpoint
```

This is a file/module split, not a service-layer framework. Replace the tuple
`ApiError(StatusCode, &'static str)` with a typed code plus safe message so the
editor does not parse arbitrary response text.

### 11.3 SDK pin

Give CLI the same cross-repository discipline as the editor:

- add `.github/sdk-ref`;
- add a pin script with main-ancestry verification;
- make CI/release checkout that exact commit;
- record the SDK SHA in release evidence; and
- land SDK changes before updating the pin.

`Cargo.lock` does not pin a path dependency checkout.

## 12. Tracing and diagnostics

### 12.1 Ownership

- Libraries depend on the `tracing` facade and emit spans/events.
- Libraries never initialize a subscriber.
- `mb-printer-cli` and `mb-print-cloud` binaries install/configure subscribers.
- Browser/WASM uses a safe host diagnostics callback or performance measure;
  it does not silently install a global subscriber.

### 12.2 Span vocabulary

Use stable dotted names:

```text
label.validate
label.materialize
label.render
label.export
resource.decode
pdf.normalize
sheet.plan
sheet.page
sheet.export
protocol.plan
print.execute
print.job
cloud.agent.session
cloud.job
```

Use `#[instrument(skip_all, fields(...))]` or explicit spans. Safe fields:

- operation/job correlation ID generated by the host;
- page/item/action index;
- width, height, DPI;
- bounded element/resource/page/action counts;
- input/output byte counts;
- printer model and protocol enum;
- transport kind, not endpoint/path;
- state/outcome and stable error code; and
- duration from the subscriber/host timer.

Never record:

- document name or JSON;
- text, template, barcode, or QR values;
- element/resource IDs, bytes, hashes, or font data;
- CSV records;
- raw printer responses;
- file paths, IP addresses, URIs, certificates;
- bearer/pairing/cloud tokens; or
- full error `Display` strings from validation, render, transport, or execution.

In CLI, create the job span before `spawn_blocking` and explicitly instrument or
enter it inside the worker. In cloud, correlate API submission, broker state,
agent delivery, progress, and terminal state by job ID. Keep high-cardinality
IDs out of metric labels even when they are acceptable in restricted logs.

Add a captured-subscriber test that asserts the field allowlist and forbidden
values. Test the browser diagnostic schema and default-disabled behavior.

## 13. Classic sheet integration

The detailed sheet plan remains the feature specification, with these required
amendments:

1. Run architecture Phases 0–3 before implementing the sheet Rust/WASM API, and
   Phases 0–5 before editor integration.
2. Return normalized geometry from `planSheet`:

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
   ```

   Use bounded `u32` indices in explicit WASM DTOs even if Rust internals use
   `usize`.

3. Map per-item render failures as `Render { item, source }`; expose only the
   bounded item index in wire details.
4. Enforce wire limits before parsing and pass central processing limits into
   sheet planning/export.
5. Retain packed one-bit pages, not all full `MonoRaster` pages.
6. Expose sheet operations through the narrow `SheetExporter` port.
7. Give the core exporter an explicit validated DPI. The editor passes 300 DPI;
   the CLI compatibility adapter preserves its existing `--dpi` value. Then
   remove the duplicate implementation.
8. Keep classic-sheet PDF outside thermal `PrintRoute`, local jobs, and cloud
   jobs in the first release.

The deliberately small editor MVP remains A4, Letter, custom grids, fixed 300
DPI, first slot, copies/CSV records, PDF export, and system print-dialog handoff.
The shared core accepts explicit DPI only to preserve the existing CLI contract.
Calibration profiles, editor-selectable DPI, irregular-layout authoring, native
CUPS submission, colour, and vector output remain future extensions.

## 14. Implementation sequence

### Phase 0 — freeze contracts and recover verification capacity

1. Recover enough disk space through an explicitly approved cleanup or a
   separate target directory.
2. Record current native/WASM/browser execution fixtures and canonical fixtures.
3. Define `WireLimits`, `ProcessingLimits`, stable error codes, safe WASM error
   schema, and tracing field allowlist.
4. Add CLI SDK pinning before cross-repository feature work.
5. Make the pinned real-WASM contract suite mandatory in release CI.

Exit condition: full baseline suites can run and every cross-repository build
uses a recorded SDK commit.

### Phase 1 — repair current correctness defects

1. Fix built-in-font size validation and standard base64 decoding in core.
2. Add checked bounds arithmetic and fallible raster constructors.
3. Repair group delete/duplicate/group invariants.
4. Replace exported cross-variant element patches with narrow commands.
5. Fix IndexedDB transaction completion and `entries()` request ordering.
6. Serialize editor bootstrap and add autosave flush/error handling.
7. Freeze browser executor pacing, cancellation, timeout, and ambiguous-write
   fixtures, then replace the editor duplicate with the SDK browser adapter.
8. Persist the exact local request body and idempotency key before submission;
   make polling observe cancellation and distinguish stop-watching from remote
   cancellation.
9. Add regression tests before refactoring surrounding modules.

Exit condition: known document, group, persistence, arithmetic, browser pacing,
and ambiguous-submission defects are closed without changing intended output.

### Phase 2 — central safety and lossless canonical conversion

1. Enforce `WireLimits` at WASM/HTTP/CLI entrypoints and thread
   `ProcessingLimits` through validation, resource decode, render, PDF
   normalization/export, and protocol planning.
2. Configure image/SVG/PDF limits before expensive work where their libraries
   permit it, and document the residual SVG parse-complexity risk.
3. Cap copies, documents, pages, total pixels, actions, and bytes.
4. Make canonical adapter round-trips lossless without editor metadata.
5. Generate/check canonical wire types and add SDK-origin fixtures.
6. Keep existing TypeScript algorithms temporarily behind parity tests.

Exit condition: hostile or excessive input fails before large allocation, and
supported canonical files preserve render semantics across open/save.

### Phase 3 — consolidate output semantics in Rust

1. Move document render-profile interpretation to core.
2. Unify printer/media preparation and remove host-specific default behavior.
3. Make template materialization and zone/batch planning authoritative in core.
4. Use those operations from WASM, CLI, local API, export, and print paths.
5. Add native/WASM pixel and plan equivalence fixtures.
6. Remove TypeScript/native duplicates only after parity passes.

Exit condition: identical canonical input and explicit options produce identical
materialized documents, pixels, and protocol plans from every host.

### Phase 4 — unify batch execution and job APIs

1. Add shared batch execution with aggregate progress and ambiguity stop.
2. Add typed local API errors.
3. Verify the Phase 1 executor and recovery behavior through local, direct, and
   batch integration tests.

Exit condition: all routes use the repaired executor/recovery semantics and
batch orchestration preserves idempotency, cancellation ambiguity, and recovery
state.

### Phase 5 — thin boundaries and add observability

1. Extract the cohesive CLI job subsystem without changing routes; split other
   handler groups only when an independent change needs that boundary.
2. Keep the current Svelte orchestration until concurrent operation state proves
   a smaller typed status model is necessary. Do not introduce empty
   `EditorSession`, `PrinterSession`, or controller shells merely to reduce line
   count.
3. Centralize download/blob cleanup behind a directly injectable browser port.
4. Split editor SDK dependencies only into the narrow materializer, sheet, and
   execution ports used by production components.
5. Add core/native tracing facade spans, CLI subscriber, correlated cloud spans,
   and browser diagnostics.
6. Verify redaction and bounded fields.

Exit condition: UI and transport boundaries orchestrate typed operations rather
than implementing domain policy, and production hosts can correlate safe job
events.

### Phase 6 — implement and migrate classic sheets

The Rust/WASM and CLI work below may start once Phases 0–3 pass. The editor UI
work remains gated on Phases 0–5, as required by the sheet feature plan.

1. Implement core grid normalization, placement, packed-page imposition, and
   exact-size PDF output under central limits.
2. Expose mandatory lightweight `planSheet` and document-bearing
   `buildSheetPdf` operations through `SheetExporter`.
3. Return normalized layout geometry for the editor preview without sending
   complete documents through each interactive planning call.
4. Migrate CLI compatibility flags to core and remove `raster::sheet_pdf`.
5. Add the focused editor sheet dialog and PDF/system-print handoff.
6. Land SDK first, update editor and CLI pins, then land host integrations.

Exit condition: CLI and editor use the same Rust sheet implementation and exact
placement plan; no duplicate sheet geometry remains.

### Phase 7 — qualification and cleanup

1. Run full Rust, WASM, editor, browser, CLI, cloud, and release suites.
2. Run deterministic PDF/raster goldens and physical registration fixtures.
3. Update user, device, API, and release documentation.
4. Remove temporary parity code and compatibility shims whose deprecation has
   completed.
5. Record unresolved future work separately rather than broadening the release.

Exit condition: software evidence is reproducible, physical claims are scoped,
and temporary duplicate authorities are gone.

## 15. Test matrix

### Rust core

- schema/semantic validation parity;
- base64 invalid/truncated/oversized cases;
- checked arithmetic at integer boundaries;
- pre-decode resource limits;
- dither/render-profile fixtures;
- native/WASM pixel equivalence;
- copy/action/byte caps;
- packed raster validation;
- template/zone/sheet placement properties;
- exact PDF physical dimensions; and
- tracing field redaction.

### Native and CLI

- browser/native execution-event equivalence;
- pacing after physical fragments;
- atomic command limit;
- timeout and response fallback;
- cancel before/after potentially accepted writes;
- existing CLI sheet flags through core compatibility adapter;
- pinned SDK SHA in CI/release evidence; and
- job span propagation into blocking execution.

### Editor TypeScript

- canonical SDK-origin round-trip without editor metadata;
- font/render/zone/field/extension preservation;
- group graph mutation invariants;
- narrow command type/runtime behavior;
- no-op/coalesced history;
- IndexedDB inactive/abort behavior;
- ordered bootstrap and autosave failure;
- local idempotency recovery and cancel distinction;
- batch ambiguity stop; and
- wire-error/diagnostic type guards.

### Browser/WASM

- mandatory pinned SDK load;
- malformed and oversized inputs;
- no large grayscale JSON boundary;
- diagnostics disabled by default and safe when enabled;
- offline edit/export;
- normalized sheet preview equals exported placement; and
- popup-blocked PDF fallback with non-authoritative print wording.

### Cloud

- job correlation across API, broker, agent, and terminal update;
- idempotency/replay remains unchanged;
- no document/token/raw-response fields in logs; and
- bounded metric labels.

## 16. Expected high-level file changes

```text
mb-printer-sdk/
  Cargo.toml
  crates/mb-printer-core/src/{document,resources,raster,render,export,protocol}.rs
  crates/mb-printer-core/src/{limits,materialize,sheet}.rs
  crates/mb-printer-native/src/lib.rs
  crates/mb-printer-wasm/src/lib.rs
  crates/mb-printer-wasm/browser-adapters.ts
  fixtures and native/WASM equivalence tests

mb-printer-cli/
  .github/sdk-ref
  scripts/pin-sdk.*
  src/api/{mod,grants,connections,documents,jobs,laposte}.rs
  src/{main,raster,jobs}.rs
  CI/release workflows and contract tests

mb-label-editor/
  packages/label-editor/src/lib/{model,commands,history,sdk-document,store}.ts
  packages/label-editor/src/lib/persistence/database.ts
  packages/label-editor/src/lib/print/{types,direct,local-api,cloud}.ts
  packages/label-editor/src/lib/{batch,sheets,browser-files,materializer}/*
  apps/pwa/src/App.svelte
  apps/pwa/src/sdk.ts
  canonical, persistence, route, WASM, and browser tests

mb-print-cloud/
  src/{main,api,grpc}.rs
  tracing/redaction/job-lifecycle tests
```

Exact splitting follows the repositories’ existing conventions. Do not mix
unrelated formatting, UI redesign, or protocol additions into these phases.

## 17. Acceptance criteria

The architecture work is complete when:

- supported canonical documents preserve print semantics across editor
  open/save without private metadata;
- editor commands cannot create dangling or cyclic group references;
- persistence resolves on transaction completion and bootstrap cannot overwrite
  recovery state;
- all expensive operations enforce shared limits before large allocation;
- external arithmetic is checked and typed errors reach host boundaries;
- one render profile and printer-preparation path is used by all hosts;
- one browser executor owns protocol pacing and cancellation semantics;
- local and cloud submission recovery retain exact idempotency snapshots;
- CLI and editor builds pin merged SDK commits;
- safe tracing correlates print jobs without document/customer/credential data;
- one Rust sheet implementation serves both CLI and editor;
- Svelte components own interaction/presentation, not canonical algorithms; and
- complete verification suites pass after disk capacity is restored.

## 18. Evolution guardrails

Keep future evolution possible through typed ports and additive wire fields, but
do not implement future features early.

- Add protocol variants to the closed enum; do not create a runtime protocol
  plugin system.
- Add narrow engine ports; do not create a service locator.
- Add packed pages; do not build a streaming PDF framework until measured need.
- Add one worker around a bounded high-level WASM call only if 300-DPI timing
  proves blocking; do not design a worker pool.
- Add named printer calibration profiles only when the host can identify the
  target printer.
- Add editor-selectable DPI, colour, vector, native office-printer submission,
  and irregular-layout authoring as separate features with their own evidence.
- Prefer a compatibility adapter and measured deprecation over maintaining two
  authorities indefinitely.
