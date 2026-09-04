# Editor remediation plan: runes migration, performance, UI and responsive shell

## 1. Goal

Bring the label editor to a state where:

- every Svelte component is written in Svelte 5 runes mode and legacy syntax
  cannot be reintroduced;
- pointer moves, typing and slider drags cost a bounded, small amount of work
  regardless of document size or undo depth;
- the shell is usable from a 360 px phone to a 3440 px ultrawide, with touch
  targets, safe areas and system dark mode handled;
- the first-minute user experience matches mature design tools: fit-to-view,
  sensible insert placement, informative layers, a pinned inspector; and
- styling comes from the shared mb-ui design system rather than local copies.

The plan is ordered so that each phase is independently shippable and each
phase has a gate that CI enforces before the next one starts. The runes
migration is Phase 2, not last, because the state-model refactor in Phase 1
is what makes the migration mechanical, and the migration is what makes the
remaining performance work hold.

## 2. Baseline (2026-09-04)

Measured on the running dev server with Playwright, 1920 x 1080, 40 text
elements on a 50 x 30 mm label:

| Measure | Value |
| --- | --- |
| Scripted insertion of 40 text elements | 1650 ms |
| Scripted 100-step drag of one element | 403 ms, 24 frames rendered |
| DOM nodes total, of which sidebar | 797, 382 |
| Components using `export let` or `$:` | all 27 |
| Components using `$state`, `$derived`, `$props` or `$effect` | 0 |
| IndexedDB writes per store emission | 3 unthrottled plus 1 debounced |
| Deep clones per undo command | 4, plus 2 full `JSON.stringify` |
| Controls under 32 px at any viewport | 99 |
| Media queries for `pointer: coarse`, `hover: none`, `env(safe-area-inset-*)` or `prefers-color-scheme` in the editor package | 0 |

Measured by `tests/browser/perf.spec.ts` at Phase 0 (2026-09-04), one 100-step
drag of a text element on the 178 KB image fixture plus 40 inserted texts:

| Measure | Value |
| --- | --- |
| IndexedDB write transactions during the drag and 2.5 s settle | 316 |
| SDK renders during the drag | 102 |
| Longest task during the drag | 80 ms |
| Scripted insertion of 40 text elements | 4568 ms |

After Phase 1 (2026-09-04), same spec:

| Measure | Value |
| --- | --- |
| IndexedDB write transactions during the drag and 2.5 s settle | 1 |
| SDK renders during the drag | 1 |
| Longest task while the pointer is down | 0 ms (none recorded) |
| Longest task after release (one synchronous WASM raster of the preview) | 64 to 67 ms |
| Scripted insertion of 40 text elements | 1632 to 1736 ms |

After Phase 4 (2026-09-05), same spec, plus `tests/browser/viewports.spec.ts`:

| Measure | Value |
| --- | --- |
| IndexedDB write transactions during the drag and 2.5 s settle | 1 |
| SDK renders during the drag | 1 |
| SDK measures during the drag | 0 |
| Longest task while the pointer is down | 0 ms (none recorded) |
| Longest task after release (synchronous WASM raster) | 71 ms |
| Scripted insertion of 40 text elements | 2086 ms |
| Components in runes mode | 30 of 30 (`svelte.legacy.mjs` deleted, `runes: true` in both configs) |
| Width media queries off the 40/48/64/90rem scale | 0 (`check:breakpoints`) |
| Visible controls under 44 px on the 360 px and 768 px touch viewports, per tab | 0 |
| Browser tests | 83 (editor 71, external resources 3, cloud print 1, perf 1, viewports 8) |

Deviations decided during Phases 3 and 4: keyboard resize lives on
Ctrl+Arrow and rotate on Ctrl+Alt+Arrow and the bracket keys, because
Shift+Arrow already means a 1 mm nudge in the tests and the user guide; the
print route and printer selects stay in the header instead of a print
dialog; `focusInspector` was not needed once the inspector got a stable id;
the phone and tablet panels overlay the label (bottom sheet and drawer) rather
than stacking under it, so the label never drops below 16rem; the data
sheet dock is a region under the label on desktop and a dialog below 64rem.

Deviations from the plan below, decided during Phase 1: no separate
`editor.document` readable was added because Phase 2.1 replaces the store
shape; ESLint rules the migration will clear are warnings under a
`--max-warnings` cap that only decreases, and the repository-wide Prettier
run is deferred to the end of Phase 2; image elements keep memoised data
URLs rather than object URLs because the browser suite asserts the `data:`
scheme; the data sheet keeps index keys; the post-release WASM raster stays
on the main thread until preview rendering moves to a Worker.

Root cause of the slowness: `createEditorStore` in `store.ts` exposes one
merged snapshot that emits on every document, selection or view change.
Every component reads `$editor`, and `Canvas.moveDrag` calls `setView` on
every pointer move. Legacy `$:` blocks invalidate on the whole store variable,
so one pointer move triggers IndexedDB writes, a document fingerprint hash,
an SDK layout measurement, a synchronous WASM raster render, and a
re-render of every panel including hidden tabs.

## 3. Enforcement, in place before any migration commit

These land first, in one commit, so that every later commit is checked.

### 3.1 Compiler-level runes enforcement

Add `packages/label-editor/svelte.config.js` and
`apps/pwa/svelte.config.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default { preprocess: vitePreprocess(), compilerOptions: { runes: true } };
```

With `runes: true`, `export let`, `$:`, `$$props`, `$$restProps`,
`createEventDispatcher`-style patterns and `on:` directives are compile
errors. `svelte-check` reads this config, so `npm run check` fails on any
legacy component. The vite plugin reads it too, so the PWA build fails.

Until the migration is complete, the config carries a temporary allow-list
so CI stays green while components are converted one by one:

```js
const legacy = new Set([/* file names still to migrate */]);
export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
  vitePlugin: { dynamicCompileOptions({ filename }) { if (legacy.has(basename(filename))) return { runes: false }; } },
};
```

The allow-list only shrinks. `scripts/check-runes.mjs` (below) fails if a
file is in the list but no longer contains legacy syntax, so entries cannot
linger.

### 3.2 Source-level check

Add `scripts/check-runes.mjs`, wired as `npm run check:runes` and added to
`ci.yml` and `deploy-pages.yml` next to `check:workflows`. It scans every
`.svelte` file under `packages/label-editor/src` and `apps/pwa/src` and fails
on:

- `export let ` outside a `<script context="module">` or `<script module>`;
- a line starting with `$:`;
- `<svelte:options runes={false}`, so nobody opts a component back out;
- `on:click=`, `on:input=` and any other `on:` directive;
- `createEventDispatcher(`;
- `import { writable`, `readable` or `derived } from 'svelte/store'` inside a
  `.svelte` file (stores remain allowed in `lib/` during Phase 1 and are
  removed by Phase 2.4);
- an allow-list entry in `svelte.config.js` whose file no longer needs it.

This mirrors the existing `check-workflows.mjs` and `check-license-policy.mjs`
scripts, so it fits the repository's own pattern for policy checks.

### 3.3 Lint and format

Install `prettier`, `prettier-plugin-svelte`, `eslint`, `typescript-eslint`,
`eslint-plugin-svelte` and `svelte-eslint-parser`. Configuration:

```json
// .prettierrc
{ "singleQuote": true, "printWidth": 120, "plugins": ["prettier-plugin-svelte"],
  "overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }] }
```

```js
// eslint.config.js
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
export default ts.config(
  ...ts.configs.recommendedTypeChecked,
  ...svelte.configs['flat/recommended'],
  { languageOptions: { parserOptions: { project: true, extraFileExtensions: ['.svelte'] } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'svelte/no-reactive-reassign': 'error',
      'svelte/prefer-svelte-reactivity': 'error',
      'svelte/require-each-key': 'error',
      'svelte/no-unused-svelte-ignore': 'error',
    } },
);
```

`npm run lint` and `npm run format:check` are added to CI. The repo-wide
reformat is one dedicated commit whose SHA goes into
`.git-blame-ignore-revs`, made after Phase 2 so the formatting commit does
not have to be rebased over every behavioural change.

`no-floating-promises` will immediately flag the voided IndexedDB writes in
`App.svelte`. That is intended; those writes are Phase 1.1.

### 3.4 Performance budget test

Add `tests/browser/perf.spec.ts` that loads the fixture in
`tests/fixtures/`, inserts 40 elements, runs a scripted 100-step drag, and
asserts:

- no single `longtask` entry above 50 ms during the drag;
- at most one IndexedDB `readwrite` transaction opened during the drag
  (instrumented via a `page.addInitScript` wrapper around
  `IDBDatabase.prototype.transaction`);
- at most 2 calls to the SDK `render` function during the drag (wrapped the
  same way through the `window.__mbSdkCalls` counter the PWA exposes in test
  mode).

The thresholds start loose and are tightened as phases land. The test runs
in the existing `npm run test:browser` job.

### 3.5 Repository hygiene

Move `label.json` and `label.mb-label.json` to `tests/fixtures/` (they are
useful as a large-document fixture for the perf test) or delete them. Fold
`tests/browser/tmp-font.spec.ts` and `tests/browser/tmp-overflow.spec.ts`
into `editor.spec.ts` or delete them. Add `*.mb-label.json` at the repo root
to `.gitignore`.

Gate for Phase 0: CI runs `check:runes`, `lint`, `format:check` and the perf
spec. The allow-list contains all 27 components.

## 4. Phase 1: state model and hot paths (no component syntax changes)

Everything here is in `lib/` or is a small edit to one component. Each item
is a separate commit with its own test.

### 1.1 Persistence storm, `apps/pwa/src/App.svelte`

Replace the single `editor.subscribe` that calls four writers with:

- `autosave(document)` only when `state.document` identity changed;
- `savePreferences` debounced at 1000 ms and only when the four persisted
  view fields changed, compared by value;
- `saveTemplate` debounced at 1500 ms and only when `document.template`
  identity changed;
- `saveRecent` only from `open`, `replace` and `save`, never from subscribe;
- every promise handled with `.catch(report)`; nothing is `void`ed.

`createAutosaver` in `persistence/database.ts` gets a max-wait of 5000 ms so
a long gesture still saves, and skips the `structuredClone` when the
document reference is unchanged.

Test: a unit test on the autosaver for max-wait, and the perf spec's
IndexedDB assertion tightened to 1 transaction per drag.

### 1.2 History without clones, `lib/history.ts`

- `get document()` and `get state()` return the internal document without
  cloning. Freeze it with `Object.freeze` in dev builds to catch mutation.
- Remove `hasSemanticChange`. `changed()` in `commands.ts` returns the
  original document object when the mutation produced no change; history
  compares by identity.
- Entries hold shallow copies that share `resources` and `fonts` by
  reference. Add a test asserting that consecutive entries share the same
  `resources` array identity and that undo depth 100 on the 180 KB fixture
  retains under 2 MB (measured with `process.memoryUsage` delta in Vitest).
- Coalesce keys for Inspector edits (`inspector:${id}:${field}`) and
  DataSheet cell edits (`cell:${row}:${field}`) so a typed word is one undo
  entry.

### 1.3 Preview gating

- `Canvas.preparePreview` runs only when `document` identity or
  `printer?.id` changed, debounced at 120 ms trailing.
- `ThermalPreview.draw` keys on `${document.id}:${document.modifiedAt}:${currentRecord}`
  and reuses a single offscreen canvas.
- `MediaPanel.calculateLength` gets the same identity gate.
- `continuous-media.ts`: replace the BigInt FNV with a 32-bit
  `Math.imul` FNV over `charCodeAt`, and replace `localeCompare` in
  `stableStringify` with plain comparison. Existing fingerprint tests are
  updated to the new hash values.
- `continuousSettings(document)` is memoised on
  `document.media.continuousSettings` identity so it stops producing a fresh
  object per call.

### 1.4 Pointer-move budget, `Canvas.svelte` and `lib/snapping.ts`

- `moveDrag` coalesces into one `requestAnimationFrame` per frame.
- Snap targets are computed once in `startDrag` and stored on the drag
  object; `snapMove` takes precomputed targets.
- `setView({guides})` is skipped when the guides array is equal to the
  current one.
- Resize and rotate previews apply a CSS transform override to the affected
  element ids instead of `command.apply` on the whole document. The real
  command runs once on `pointerup`.
- Pinch: `gestureStart` tracks pointers unconditionally and `moveDrag`
  prefers the gesture branch when two pointers are active, cancelling any
  single-pointer drag.

### 1.5 Index the command layer, `lib/commands.ts`, `lib/model.ts`, `lib/zones.ts`

`changed()` builds `{ byId: Map<Id, LabelElement>, zonesById: Map,
lockedIds: Set<Id>, hiddenIds: Set<Id> }` once and passes it to
`fitGroupsToChildren`, `elementById`, `elementAncestry`,
`effectiveElementZone` and `elementRootOffset`. `isEffectivelyLocked` and
`isEffectivelyVisible` accept the index. Add a Vitest benchmark asserting a
move command on a 500-element, 50-group document completes under 5 ms.

### 1.6 Render-path caches, `Canvas.svelte`

- Sorted element list derived once per document.
- Image resources exposed through a `Map<id, objectUrl>` built once per
  `document.resources` identity, revoked on change and on destroy.
- Text measurement memoised by `(id, text, fontSize, fontFamily, fontWeight,
  width, height, fontGeneration)`; width measured once, not twice.
- Guides `{#each}` keyed.
- When `sdk` is present and the element is not selected, do not render the
  inner content that is then hidden by `visibility: hidden`.

### 1.7 Smaller leaks

- `apps/pwa/src/sdk.ts`: `stampCache` becomes an 8-entry LRU storing
  `Uint8Array`.
- `AssetPanel`: build the `AssetCatalogue` once per manifest and private
  set; compute category counts in one pass over the filtered results.
- `DataSheet`: records get a stable `id` at CSV import in
  `lib/template/csv.ts`; rows are keyed by it.

Gate for Phase 1: perf spec passes with 1 IndexedDB transaction and at most
2 SDK renders per drag, and no long task above 50 ms. Baseline numbers are
re-measured and recorded in this document.

## 5. Phase 2: runes migration

Order matters. The store goes first because every component depends on it,
and Canvas goes second because it is the hot path. Each component is one
commit that also removes its allow-list entry, so `check:runes` proves the
conversion.

### 2.1 Store as a runes class, `lib/store.ts`

```ts
export class EditorState {
  document = $state.raw<LabelDocument>(initial);   // immutable, replaced by commands
  selection = $state(new SvelteSet<Id>());
  view = $state<ViewState>(defaultView);
  selectedElements = $derived(this.document.elements.filter((e) => this.selection.has(e.id)));
  selectionBounds = $derived(/* from selectedElements */);
  execute(command: Command) { ... }  undo() { ... }  redo() { ... }
}
```

`$state.raw` on the document is deliberate: the document is replaced
wholesale by commands and never mutated, so deep proxying would be pure
overhead. Selection and view are fine-grained. A `subscribe` shim built from
`$effect.root` and `createSubscriber` keeps the existing `$editor` contract
alive for host applications until they migrate; the shim is marked
deprecated and removed at the end of Phase 2.

The public `EditorStore` interface in `index.ts` keeps its method names.
Existing `tests/editor.test.ts` runs against the class unchanged except for
construction.

### 2.2 Canvas, `Canvas.svelte`

`svelte-migrate --runes` first, then by hand:

- `$props()` for `editor`, `sdk`, `printer`, `materializer`;
- `$derived` for `displayDocument`, `sortedElements`, `selectionBounds`,
  `rollSettings`, `currentRecord`, `resourceUrls`;
- one `$effect` for `preparePreview` that reads only `editor.document` and
  `printer?.id`, returns a cleanup that cancels the pending debounce;
- one `$effect` for the object-URL map with revoke on cleanup;
- drag, resize and rotate maths moved to `lib/canvas-geometry.ts` with unit
  tests; text measurement moved to `lib/text-layout.ts`.

Verification: the perf spec's SDK-render assertion drops to 1 per drag
because pan and zoom can no longer invalidate the preview.

### 2.3 ThermalPreview, LabelEditor, Toolbar, EditorMenus, Inspector, Layers

Mechanical conversion. `ThermalPreview` replaces the manual `generation`
counter with an `$effect` whose cleanup aborts the in-flight render.
`LabelEditor` renders only the active sidebar tab with `{#if}` and hoists the
Asset panel's query, page and favourites into a module-level `$state` in
`lib/assets/state.svelte.ts` so they survive tab switches. `Layers` computes
visibility and lock flags once inside `rows()`.

### 2.4 Panels and dialogs

AssetPanel, DataPanel, DataSheet, MediaPanel, SheetPanel, DirectPrintPanel,
LocalServicePanel, CloudPrintPanel, LaPostePanel, BatchPanel, GuidesPanel,
JobRecoveryPanel, ShortcutsPanel, TemplateSyntaxPanel, LibraryPanel,
ExternalResourceConnectionsPanel, RemoteAssetPreview, Modal, Menu, Icon.

AssetPanel is split into `AssetBrowserLocal`, `AssetBrowserRemote` and
`AssetImport` during its conversion. The debounced remote search becomes an
`$effect` with `clearTimeout` in its cleanup. Modal gains initial focus,
focus trap and focus restore in an `$effect`. Menu gains `role="menu"`,
Escape and arrow-key navigation.

`svelte/store` imports are removed from every `.svelte` file. Remaining
store usage in `lib/` (the subscribe shim, external resource manager) is
converted to `$state` in `.svelte.ts` modules or to plain classes with
`createSubscriber`.

### 2.5 App shell, `apps/pwa/src/App.svelte`

Converted last because it is the largest consumer. During conversion:

- print-route and cloud-session state moves to `apps/pwa/src/print-routes.svelte.ts`;
- preferences to `apps/pwa/src/preferences.svelte.ts`;
- the five inline `printers.find(...)` calls collapse to the existing
  `selectedPrinterDefinition` derived value;
- `editor`, `sdk`, `materializer` and `printer` are provided through
  `setContext` and read with `getContext` in LabelEditor's children,
  removing three levels of prop drilling.

### 2.6 Remove the shim and the allow-list

Delete the `subscribe` shim, delete the `dynamicCompileOptions` block from
both `svelte.config.js` files, and make `check:runes` fail if the block ever
returns. Reformat the repository in one commit and record it in
`.git-blame-ignore-revs`.

Gate for Phase 2: `check:runes` passes with an empty allow-list;
`svelte-check` passes with `runes: true` and no `runes={false}` anywhere;
all unit, browser and packaging tests pass; the perf spec passes at 1 SDK
render per drag.

## 6. Phase 3: first-minute UI fixes

Each is independent and can be interleaved with Phase 2.

### 3.1 Fit-to-view and zoom presets

- `lib/view.ts` gains `fitToView(media, viewport, padding)`.
- Applied on document open, on media change, and on viewport resize until
  the user zooms manually (tracked as `view.zoomMode: 'fit' | 'manual'`).
- View menu and shortcuts: Fit (Shift+1), 100% (Ctrl+0), 200% (Shift+2),
  zoom in and out (Ctrl+= and Ctrl+-).
- Zoom readout moves from the toolbar to a small control anchored to the
  bottom-right of the canvas; click opens the preset list.
- Rulers re-tick at 1, 5 and 10 mm depending on zoom and show the unit.

### 3.2 Insert placement

`lib/insert.ts` places a new element at the centre of the visible label
area, cascades by one grid step when an element of the same type already
occupies that position, and returns the id so the caller can select it and
focus the inspector. Shape tools also support drag-to-draw on the canvas.

### 3.3 Layers

- Default names from content: text shows its first 24 characters, QR and
  barcode show their value, images show the resource name, shapes show type
  and size.
- Type icon per row, double-click to rename, context menu with Bring
  forward, Send backward, Duplicate, Delete, keyboard reorder with
  Alt+Arrow.
- The duplicate heading is removed by giving panels an optional `title`
  prop (or adopting mb-ui `Panel`).

### 3.4 Pinned inspector

Layers and Properties stop sharing one scroll region. Under 90rem the
Layers list gets its own scroll with `max-height: 40%` and Properties stays
visible below it. At 90rem and above, a second rail shows Layers and
Properties permanently while Assets, Data and Printer keep the tabbed rail.

### 3.5 Toolbar

Split into: insert tools as a vertical left rail (icon only, tooltip with
shortcut); undo and redo beside the menu bar; align and arrange in a
floating selection bar above the selected elements; zoom at the canvas.
Anything that does not fit goes into an overflow menu, never clipped.
`font-size: 0` label hiding is removed.

### 3.6 Header

One row: brand, editable document title with saved state, media chip, and
one Print button that opens a print sheet where route and printer are
chosen. The disabled state explains why in a tooltip and inline text. Menus
collapse into a single menu button below 40rem.

### 3.7 Canvas chrome

Cut-line label, warning and record badges move out of the scaled `.pan`
layer into the unscaled viewport layer. Selection handles get a 16 px hit
area (32 px under `pointer: coarse`). Blank labels show an empty-state hint.
Double-click on a text element enters inline edit.

### 3.8 Assets and Data

Error state with message and Retry in the asset panel; persistent favourite
star under `hover: none`; the star becomes a sibling `<button>` rather than
a span nested inside the tile button. Data tab offers "Start from this
label's fields" and a sample CSV. The record sheet opens in a bottom dock
on wide screens or a dialog on narrow ones.

### 3.9 Keyboard and accessibility

Shift+Arrow resizes, Ctrl+Shift+Arrow rotates by 1 degree, `[` and `]`
rotate by 15. `role="application"` on the canvas stays only once this
contract exists. Focus-visible ring on every interactive element via
`.mb-label-editor :focus-visible`. `aria-live` on row and layer counts.

Gate for Phase 3: browser tests for fit-to-view on open, cascade insert,
layer naming, keyboard resize, and focus trap in Modal.

## 7. Phase 4: responsive shell

### 4.1 Breakpoint scale

One set of constants in `core.css` as custom media (via the
`@custom-media` PostCSS plugin) or documented values used verbatim:
`40rem`, `48rem`, `64rem`, `90rem`. All existing `600px`, `760px`, `800px`,
`900px`, `36rem` and `40rem` queries are replaced.

### 4.2 Shell behaviour

| Range | Behaviour |
| --- | --- |
| below 40rem | Brand, one menu button, Print. Toolbar is a single horizontal icon strip with `overflow-x: auto` and scroll-snap. Canvas takes the full remaining `dvh`. Side panel is a bottom sheet over the canvas, `max-height: 70dvh`, opened by a persistent button, closed by scrim tap. Dialogs are full screen with safe-area padding. |
| 40rem to 64rem | Single-row header. Toolbar at most two rows. Side panel is a right-hand overlay drawer with scrim, `width: min(22rem, 80vw)`. Resizer hidden. |
| 64rem to 90rem | Current grid. Canvas track `minmax(20rem, 1fr)`. Rail 240 px to `min(50vw, 480px)`, re-clamped on `resize` and on read from localStorage. |
| 90rem and above | Two rails as in 3.4. Toolbar groups centred. Rail capped at 720 px. |

### 4.3 Orthogonal rules

- `@media (pointer: coarse)`: 2.75rem minimum height on buttons, inputs,
  selects, tabs; 16 px resizer with visible grip.
- `@media (hover: none)`: no hover-only affordances.
- `env(safe-area-inset-*)` on the app bar, footer and bottom sheet.
- `dvh` for every viewport-relative height; the one `42vh` in
  `LabelEditor.svelte` is replaced.
- `ThermalPreview` observes the canvas with `ResizeObserver` and listens to
  `matchMedia('(resolution: Ndppx)')` so DPR changes re-sample.
- `ExternalResourceConnectionsPanel` drops its `min-width`; `Modal` gains a
  `size` prop.
- Footer becomes a flex row; the build tag hides below 40rem.

Gate for Phase 4: the screenshot script from this review, kept as
`tests/browser/viewports.spec.ts`, asserts at each of the six viewports that
`document.documentElement.scrollWidth` equals `innerWidth`, the canvas area
is at least 20rem wide (or full width below 40rem), and no control is under
44 px in either dimension when `hasTouch` is set.

## 8. Phase 5: design system adoption

### 5.1 Tokens

- `standalone.css` becomes a literal snapshot of mb-ui semantic tokens, same
  hex values; the green accent and orange primary go away.
- `index.html` `theme-color` uses the brand clay and gains a
  `prefers-color-scheme: dark` variant.
- Three-state dark mode in `standalone.css`, mirroring `mb-ui/src/tokens.css`.
- `--mble-border-strong` set to the documented 3.33:1 value.
- `--mble-warning` is used for warnings; `--mble-radius-full` for pills;
  dead tokens deleted.
- Component-level `var(--mble-*, #hex)` fallbacks are removed; defaults live
  once in `core.css`. A stylelint rule
  (`declaration-property-value-disallowed-list`) forbids them.
- Font sizes map onto `--mb-text-micro`, `-small`, `-body`, `-h4`.
- Z-index scale: `--mble-z-canvas-chrome: 10`, `-panel-sticky: 20`,
  `-menu: 60`, `-scrim: 80`, `-dialog: 81`. The media layer gets
  `isolation: isolate` and element `zIndex` is normalised to a dense rank at
  render time so a user value cannot outrank editor chrome.

### 5.2 Patterns

Import `@makersbrain/ui/patterns.css` from `themes/mb-ui.css` and replace,
in this order: `Panel` (removes both `:global(section > h2)` hacks),
`Tabs`, `Notice`, `StatusBadge`, `EmptyState`, `TableWrap`, `DataList`,
the three `.primary` definitions, the local `.visually-hidden`. The two
`!important` rules in Canvas are removed by branching in the inline style.
`prefers-reduced-motion` block added to `core.css`.

Gate for Phase 5: stylelint passes; a browser test toggles `data-theme`
and asserts no element has `color: #fff` on a light surface; visual
snapshot of each tab at 1366 x 768 in both themes checked into
`tests/browser/__snapshots__`.

## 9. Sequencing and estimates

| Phase | Scope | Estimate | Gate |
| --- | --- | --- | --- |
| 0 | Enforcement, hygiene, perf budget | 1 day | `check:runes`, lint, format, perf spec in CI |
| 1 | State model and hot paths | 3 to 4 days | 1 IDB transaction and at most 2 SDK renders per drag, no long task over 50 ms |
| 2 | Runes migration | 4 to 5 days | Empty allow-list, `runes: true` everywhere, shim deleted, formatted |
| 3 | First-minute UI | 4 to 5 days | Browser tests for fit, insert, layers, keyboard, focus trap |
| 4 | Responsive shell | 3 to 4 days | Viewport spec at six sizes |
| 5 | Design system | 3 days | Stylelint, dark-mode assertion, snapshots |

Phases 3, 4 and 5 can run in parallel with each other after Phase 2. Phase
1 and Phase 2 are strictly sequential.

## 10. Definition of done

- `npm run check`, `check:runes`, `lint`, `format:check`, `test`,
  `test:browser` (including perf and viewport specs) and `test:package`
  pass in CI.
- No `.svelte` file contains `export let`, `$:`, `on:` directives or
  `svelte/store` imports; both `svelte.config.js` files set `runes: true`
  with no exceptions.
- Baseline table in section 2 is re-measured and the new numbers recorded
  here with the date.
- `docs/user-guide.md` updated for fit-to-view, zoom presets, layer naming,
  keyboard resize and rotate, and the phone and tablet layouts.
