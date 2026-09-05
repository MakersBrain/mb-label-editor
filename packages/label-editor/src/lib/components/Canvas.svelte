<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  import { moveElements, resizeElements, rotateElements, type Command } from '../commands.js';
  import { assetDrag } from '../asset-drag.svelte.js';
  import { evaluateTemplate } from '../template/evaluate.js';
  import {
    guidesEqual,
    mediaBounds,
    snapModeForModifiers,
    snapTargets,
    snapWithTargets,
    type SnapTargets,
  } from '../snapping.js';
  import { elementRootBounds, elementRootOffset } from '../zones.js';
  import { continuousSettings } from '../continuous-media.js';
  import { prepareDocumentForOutput } from '../output-preparation.js';
  import type { DocumentMaterializer } from '../materialization.js';
  import { GestureTracker } from '../gestures.js';
  import { onDestroy, untrack } from 'svelte';
  import type { EditorStore } from '../store.svelte.js';
  import { fitToView, labelToScreen, screenToLabel, rulerTicks, PX_PER_MM, RULER_SIZE } from '../view.js';
  import { insertElement } from '../insert.js';
  import { currentResolvedRecord } from '../template/derived.js';
  import { patchElement } from '../commands.js';
  import ZoomControl from './ZoomControl.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import type { PrinterDefinition, PrinterSdk } from '../print/types.js';
  import ThermalPreview from './ThermalPreview.svelte';
  import type { Bounds, FontResource, LabelDocument, LabelElement, Point, Resource } from '../model.js';
  import { elementAncestry, isEffectivelyLocked, isEffectivelyVisible } from '../model.js';
  interface Props {
    editor: EditorStore;
    sdk?: PrinterSdk;
    printer?: PrinterDefinition;
    materializer?: Pick<DocumentMaterializer, 'materializeRecord'>;
    /** Folds the selection bar's alignment tools into a menu on narrow screens. */
    compact?: boolean;
  }
  let { editor, sdk, printer, materializer, compact = false }: Props = $props();
  let previewDocument = $state.raw<LabelDocument | undefined>();
  let previewError = $state('');
  let previewWarning = $state('');
  let previewGeneration = $state(0);
  type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  let drag:
    | {
        kind: 'move' | 'resize' | 'rotate';
        at: Point;
        current: Point;
        ids: string[];
        element?: LabelElement;
        bounds?: Bounds;
        handle?: ResizeHandle;
        targets?: SnapTargets;
      }
    | undefined = $state.raw();
  /** Pointer moves are coalesced to one layout pass per animation frame. */
  let pendingMove: PointerEvent | undefined;
  let moveFrame: number | undefined;
  let dragPreviewDelta = $state.raw<Point>({ x: 0, y: 0 });
  /** Document with the in-progress resize or rotation applied, so the canvas shows the result before the pointer is released. */
  let dragPreview = $state.raw<import('../model.js').LabelDocument | undefined>();
  let mediaElement = $state.raw<HTMLElement | undefined>();
  /** Rubber band of an armed drawing tool, in viewport pixels. */
  let draw = $state.raw<{ at: Point; current: Point } | undefined>();
  /** The click that ends a draw must not clear the selection of the element it just made. */
  let drewJustNow = false;
  const pxPerMm = 3.7795275591;
  const gestures = new GestureTracker();
  /** Groups are not drawn, so a click on a grouped child targets its outermost group unless the user already entered the group. */
  function dragTargetFor(element: LabelElement, deep: boolean): LabelElement {
    if (deep) return element;
    const selected = editor.selection;
    const chain = elementAncestry(editor.document, element);
    return chain.find((item) => selected.has(item.id)) ?? chain[chain.length - 1];
  }
  function startDrag(event: PointerEvent, element: LabelElement) {
    const target = dragTargetFor(element, event.ctrlKey || event.metaKey);
    if (isEffectivelyLocked(editor.document, target)) return;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const current = editor.selection;
    const ids = current.has(target.id) ? [...current] : event.shiftKey ? [...current, target.id] : [target.id];
    editor.select([target.id], event.shiftKey);
    beginMove(event, ids);
  }
  /** Double-clicking a grouped child enters the group and selects that child on its own. */
  function enterElement(event: MouseEvent, element: LabelElement) {
    editor.select([element.id]);
    event.stopPropagation();
  }
  /** The selection box is the only grab surface a group has, so dragging its interior moves the whole selection. */
  function startSelectionDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    const ids = editor.selectedElements
      .filter((item) => !isEffectivelyLocked(editor.document, item))
      .map((item) => item.id);
    if (!ids.length) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    beginMove(event, ids);
  }
  function beginMove(event: PointerEvent, ids: string[]) {
    gestures.start(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gestures.active >= 2) {
      drag = undefined;
      event.stopPropagation();
      return;
    }
    dragPreviewDelta = { x: 0, y: 0 };
    const targets = editor.view.snapping
      ? snapTargets(
          editor.document.elements,
          new Set(ids),
          mediaBounds(editor.document),
          { guides: editor.view.manualGuides, zones: editor.document.media.zones },
          editor.document,
        )
      : undefined;
    drag = {
      kind: 'move',
      at: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      ids,
      targets,
    };
    event.stopPropagation();
  }
  function enterUnderPointer(event: MouseEvent) {
    const hit = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((node) => node.classList.contains('element')) as HTMLElement | undefined;
    const id = hit?.dataset.id;
    if (id) {
      editor.select([id]);
      event.stopPropagation();
    }
  }
  const selectionHasGroup = $derived(editor.selectedElements.some((item) => item.type === 'group'));
  function startResize(event: PointerEvent, handle: ResizeHandle) {
    if (!selectionBounds) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      kind: 'resize',
      at: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      ids: [...editor.selection],
      bounds: structuredClone(selectionBounds),
      handle,
    };
    event.stopPropagation();
  }
  function startRotate(event: PointerEvent, element: LabelElement) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      kind: 'rotate',
      at: { x: event.clientX, y: event.clientY },
      current: { x: event.clientX, y: event.clientY },
      ids: [element.id],
      element: structuredClone(element),
    };
    event.stopPropagation();
  }
  function gestureStart(event: PointerEvent) {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('media')) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (editor.tool && viewportElement) {
      const at = viewportPoint(event);
      draw = { at, current: at };
      return;
    }
    gestures.start(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  function viewportPoint(event: PointerEvent): Point {
    const rect = viewportElement?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }
  /** Turns the rubber band into an element; a plain click drops the tool's default size at that point. */
  function finishDraw() {
    const band = draw;
    const tool = editor.tool;
    draw = undefined;
    if (!band || !tool) return;
    const media = { width: editor.document.media.width, height: displayHeight };
    const a = screenToLabel(band.at, editor.view, media);
    const b = screenToLabel(band.current, editor.view, media);
    const round = (value: number) => Math.round(value * 10) / 10;
    const width = round(Math.abs(b.x - a.x));
    const height = round(Math.abs(b.y - a.y));
    const dragged = width >= 0.5 || height >= 0.5;
    insertElement(editor, tool, {
      at: { x: round(Math.min(a.x, b.x)), y: round(Math.min(a.y, b.y)) },
      ...(dragged ? { size: { width: Math.max(width, 0.5), height: Math.max(height, 0.5) } } : {}),
    });
    editor.setTool(undefined);
    drewJustNow = true;
  }
  /** The status bar reads the pointer in label millimetres; a tenth of a millimetre is what the rulers resolve. */
  function trackPointer(event: PointerEvent) {
    const point = screenToLabel(viewportPoint(event), editor.view, {
      width: editor.document.media.width,
      height: displayHeight,
    });
    editor.pointer = { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
  }
  function moveDrag(event: PointerEvent) {
    trackPointer(event);
    if (draw) {
      draw = { ...draw, current: viewportPoint(event) };
      return;
    }
    if (drag && gestures.active >= 2) {
      abandonDrag();
    }
    if (!drag) {
      const update = gestures.move(event.pointerId, { x: event.clientX, y: event.clientY });
      if (update)
        editor.setView({
          pan: { x: editor.view.pan.x + update.panDelta.x, y: editor.view.pan.y + update.panDelta.y },
          zoomMode: 'manual',
        });
      if (update && update.zoomFactor !== 1) editor.setZoom(editor.view.zoom * update.zoomFactor);
      return;
    }
    gestures.move(event.pointerId, { x: event.clientX, y: event.clientY });
    pendingMove = event;
    drag = { ...drag, current: { x: event.clientX, y: event.clientY } };
    moveFrame ??= requestAnimationFrame(applyPendingMove);
  }
  function applyPendingMove() {
    moveFrame = undefined;
    const event = pendingMove;
    pendingMove = undefined;
    if (!event || !drag) return;
    if (drag.kind === 'move') {
      const result = snappedDelta(event);
      dragPreviewDelta = result.delta;
      if (!guidesEqual(result.guides, editor.view.guides)) editor.setView({ guides: result.guides });
    } else {
      const command = transformCommand(event);
      dragPreview = command ? command.apply(editor.document) : undefined;
    }
  }
  function snappedDelta(event: PointerEvent) {
    const raw = dragDelta(event);
    return drag?.targets ? snapWithTargets(drag.targets, raw, snapOptions(event)) : { delta: raw, guides: [] };
  }
  function cancelPendingMove() {
    if (moveFrame !== undefined) cancelAnimationFrame(moveFrame);
    moveFrame = undefined;
    pendingMove = undefined;
  }
  /** A second finger turns a single-pointer drag into a pan or pinch gesture. */
  function abandonDrag() {
    cancelPendingMove();
    if (drag?.kind === 'move' && editor.view.guides.length) editor.setView({ guides: [] });
    drag = undefined;
    dragPreviewDelta = { x: 0, y: 0 };
    dragPreview = undefined;
  }
  function gestureEnd(event: PointerEvent) {
    if (draw) finishDraw();
    gestures.end(event.pointerId);
  }
  /** Assets dragged from the browser drop at the pointer's label position. */
  function assetDragOver(event: DragEvent) {
    if (!assetDrag.current) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }
  function assetDrop(event: DragEvent) {
    const pending = assetDrag.current;
    if (!pending || !mediaElement) return;
    event.preventDefault();
    const rect = mediaElement.getBoundingClientRect();
    const scale = pxPerMm * editor.view.zoom;
    const at = { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
    assetDrag.current = undefined;
    void pending.place(at);
  }
  function cancelInteraction(event: PointerEvent) {
    draw = undefined;
    gestures.end(event.pointerId);
    abandonDrag();
  }
  function clearSelection(event: MouseEvent) {
    if (drewJustNow) {
      drewJustNow = false;
      return;
    }
    // Clicks on canvas chrome (the selection bar and zoom control) are not clicks on empty label space.
    if (!(event.target as Element).closest('.element,.selection-box,.selection-bar,.zoom-control'))
      editor.clearSelection();
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    const viewport = event.currentTarget as HTMLElement;
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? viewport.clientHeight
          : 1;
    if (event.shiftKey) {
      const delta = (event.deltaX || event.deltaY) * unit;
      editor.setView({ pan: { x: editor.view.pan.x - delta, y: editor.view.pan.y }, zoomMode: 'manual' });
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const delta = (event.deltaY || event.deltaX) * unit;
      editor.setView({ pan: { x: editor.view.pan.x, y: editor.view.pan.y - delta }, zoomMode: 'manual' });
      return;
    }
    const delta = (event.deltaY || event.deltaX) * unit;
    const bounds = viewport.getBoundingClientRect();
    editor.setZoom(editor.view.zoom * Math.exp(-delta * 0.0015), {
      x: event.clientX - bounds.left - bounds.width / 2,
      y: event.clientY - bounds.top - bounds.height / 2,
    });
  }
  /** The canvas reports its size so fit-to-view and screen conversions can work from view state alone. */
  let viewportElement: HTMLElement | undefined = $state.raw();
  $effect(() => {
    const element = viewportElement;
    if (!element) return;
    const report = () => {
      const { width, height } = element.getBoundingClientRect();
      const viewport = { width: Math.round(width), height: Math.round(height) };
      if (viewport.width !== editor.view.viewport.width || viewport.height !== editor.view.viewport.height)
        editor.setView({ viewport });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  });
  // Fit mode follows the viewport, the media and the ruler gutters; any manual zoom or pan leaves it.
  $effect(() => {
    if (editor.view.zoomMode !== 'fit') return;
    const viewport = editor.view.viewport;
    if (!viewport.width || !viewport.height) return;
    const next = fitToView({ width: editor.document.media.width, height: displayHeight }, viewport, {
      rulerInset: editor.view.showRulers ? RULER_SIZE : 0,
    });
    untrack(() => {
      if (next.zoom !== editor.view.zoom || next.pan.x !== editor.view.pan.x || next.pan.y !== editor.view.pan.y)
        editor.setView(next);
    });
  });
  function finishDrag(event: PointerEvent) {
    gestures.end(event.pointerId);
    if (!drag) return;
    cancelPendingMove();
    if (drag.kind === 'move') {
      const snapped = snappedDelta(event);
      if (snapped.delta.x || snapped.delta.y) editor.execute(moveElements(drag.ids, snapped.delta));
      if (editor.view.guides.length) editor.setView({ guides: [] });
    } else {
      const command = transformCommand(event);
      if (command) editor.execute(command);
    }
    drag = undefined;
    dragPreviewDelta = { x: 0, y: 0 };
    dragPreview = undefined;
  }
  /** Resize or rotation command for the current pointer position, shared by the live preview and the final commit. */
  function transformCommand(event: PointerEvent): Command | undefined {
    if (!drag) return;
    const raw = dragDelta(event);
    if (drag.kind === 'resize' && drag.bounds && drag.handle) {
      const selected = editor.document.elements.filter((item) => drag?.ids.includes(item.id));
      const constrained = selected.some((item) => item.constraints?.some((value) => value.kind === 'aspect'));
      const preserve = event.shiftKey ? !constrained : constrained;
      return resizeElements(drag.ids, resizedBounds(drag.bounds, raw, preserve, drag.handle));
    }
    if (drag.kind === 'rotate' && drag.element && mediaElement) {
      const root = elementRootBounds(editor.document, drag.element);
      const center = { x: root.x + root.width / 2, y: root.y + root.height / 2 };
      const page = mediaElement.getBoundingClientRect();
      const degrees =
        (Math.atan2(
          event.clientY - page.top - center.y * pxPerMm * editor.view.zoom,
          event.clientX - page.left - center.x * pxPerMm * editor.view.zoom,
        ) *
          180) /
          Math.PI +
        90;
      return rotateElements([drag.element.id], event.shiftKey ? Math.round(degrees / 15) * 15 : degrees);
    }
    return;
  }
  function movesWithDrag(element: LabelElement): boolean {
    return !!movedIds && elementAncestry(editor.document, element).some((item) => movedIds!.has(item.id));
  }
  /** `rank` is the element's dense position in paint order, so a stored zIndex can never outrank the canvas chrome. */
  const styleFor = (element: LabelElement, offset: Point, preview: Point | undefined, rank: number) => {
    const delta = preview ?? { x: 0, y: 0 };
    return `left:${(element.transform.x + offset.x + delta.x) * pxPerMm}px;top:${(element.transform.y + offset.y + delta.y) * pxPerMm}px;width:${element.transform.width * pxPerMm}px;height:${element.transform.height * pxPerMm}px;transform:rotate(${element.transform.rotation}deg);z-index:${rank}${element.type === 'line' ? ';height:1px' : ''}`;
  };
  const boundsStyle = (bounds: Bounds, preview: Point | undefined) => {
    const delta = preview ?? { x: 0, y: 0 };
    return `left:${(bounds.x + delta.x) * pxPerMm}px;top:${(bounds.y + delta.y) * pxPerMm}px;width:${bounds.width * pxPerMm}px;height:${bounds.height * pxPerMm}px`;
  };
  const dragDelta = (event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point => ({
    x: (event.clientX - drag!.at.x) / pxPerMm / editor.view.zoom,
    y: (event.clientY - drag!.at.y) / pxPerMm / editor.view.zoom,
  });
  const snapOptions = (event: PointerEvent) => ({
    grid: editor.view.gridSize,
    gridEnabled: editor.view.showGrid,
    threshold: 1.25 / editor.view.zoom,
    mode: snapModeForModifiers(event),
  });
  function resizedBounds(bounds: Bounds, delta: Point, preserve: boolean, handle: ResizeHandle): Bounds {
    const west = handle.includes('w'),
      east = handle.includes('e'),
      north = handle.includes('n'),
      south = handle.includes('s');
    let width = Math.max(0.1, bounds.width + (east ? delta.x : west ? -delta.x : 0));
    let height = Math.max(0.1, bounds.height + (south ? delta.y : north ? -delta.y : 0));
    if (preserve) {
      const ratio = bounds.width / bounds.height;
      if ((east || west) && (north || south)) {
        if (Math.abs((width - bounds.width) / bounds.width) >= Math.abs((height - bounds.height) / bounds.height))
          height = width / ratio;
        else width = height * ratio;
      } else if (east || west) height = width / ratio;
      else if (north || south) width = height * ratio;
    }
    const x = west ? bounds.x + bounds.width - width : east ? bounds.x : bounds.x + (bounds.width - width) / 2;
    const y = north ? bounds.y + bounds.height - height : south ? bounds.y : bounds.y + (bounds.height - height) / 2;
    return { x, y, width, height };
  }
  function boundsOf(elements: LabelElement[], document = editor.document): Bounds | undefined {
    if (!elements.length) return;
    const roots = elements.map((item) => elementRootBounds(document, item));
    const x = Math.min(...roots.map((item) => item.x));
    const y = Math.min(...roots.map((item) => item.y));
    const right = Math.max(...roots.map((item) => item.x + item.width));
    const bottom = Math.max(...roots.map((item) => item.y + item.height));
    return { x, y, width: right - x, height: bottom - y };
  }
  const displayDocument = $derived(dragPreview ?? editor.document);
  const resourcesById = $derived(new Map(editor.document.resources.map((item) => [item.id, item])));
  /** Data URLs are built once per resource object; rebuilding a base64 string per render made every element re-render pay for embedded images. */
  const resourceUrls = new WeakMap<Resource, string>();
  function resourceUrl(resource: Resource): string {
    let url = resourceUrls.get(resource);
    if (!url) {
      url = `data:${resource.mimeType};base64,${resource.data}`;
      resourceUrls.set(resource, url);
    }
    return url;
  }
  const sortedElements = $derived([...displayDocument.elements].sort((a, b) => a.zIndex - b.zIndex));
  const movedIds = $derived(drag?.kind === 'move' ? new Set(drag.ids) : undefined);
  const currentRecord = $derived(currentResolvedRecord(editor.document.template));
  /** Text on the canvas shows the selected record's values; the raw expression stays editable in Properties. */
  function merged(source: string): string {
    if (!currentRecord || !source.includes('{{')) return source;
    try {
      return evaluateTemplate(source, { record: currentRecord, locale: globalThis.navigator?.language });
    } catch {
      return source;
    }
  }
  const verticalPlacement: Record<string, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
  // Plain variable: it is created lazily from template expressions, where state writes are forbidden.
  let measurer: CanvasRenderingContext2D | null | undefined;
  /** Width in pixels of the widest line, at the element's own face and size. */
  /** Widest line of a text run, memoised by font and text; cleared when an embedded face registers because its metrics change. */
  const lineWidths = new Map<string, number>();
  function lineWidth(element: Extract<LabelElement, { type: 'text' }>, text: string, size: number): number {
    if (measurer === undefined)
      measurer = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (!measurer || !text) return 0;
    const font = `${element.fontWeight} ${size * pxPerMm}px ${element.fontFamily}`;
    const key = `${font}\u0000${text}`;
    const cached = lineWidths.get(key);
    if (cached !== undefined) return cached;
    if (lineWidths.size > 2000) lineWidths.clear();
    measurer.font = font;
    const width = Math.max(...text.split('\n').map((line) => measurer!.measureText(line).width));
    lineWidths.set(key, width);
    return width;
  }
  /** Mirrors the SDK's shrink-to-fit: one linear scale down to whichever of the box's width or height binds first. */
  function fittedFontSize(element: Extract<LabelElement, { type: 'text' }>, text: string): number {
    const widest = lineWidth(element, text, element.fontSize);
    return (
      element.fontSize *
      Math.min(
        1,
        widest ? (element.transform.width * pxPerMm) / widest : 1,
        element.transform.height / element.fontSize,
      )
    );
  }
  /** Vertical placement lives on the box; the line itself is a block so an over-long line clips from its trailing edge, the way the printer truncates it. */
  const textBoxStyle = (element: Extract<LabelElement, { type: 'text' }>): string =>
    `display:flex;align-items:${verticalPlacement[element.verticalAlign] ?? 'center'};overflow:${element.overflow === 'auto-height' ? 'visible' : 'hidden'}`;
  /** The SDK owns the printed layout, so the canvas honours the same overflow rules instead of always wrapping and clipping. */
  function textStyle(element: Extract<LabelElement, { type: 'text' }>, _generation = 0): string {
    const text = merged(element.text);
    const wraps = element.overflow === 'word-wrap' || element.overflow === 'auto-height';
    const size = element.overflow === 'shrink-to-fit' ? fittedFontSize(element, text) : element.fontSize;
    // The printer truncates a long line from its tail, so an overflowing line is pinned to the start rather than centred.
    const align =
      !wraps && lineWidth(element, text, size) > element.transform.width * pxPerMm ? 'left' : element.horizontalAlign;
    return `font-family:${JSON.stringify(element.fontFamily)},sans-serif;font-weight:${element.fontWeight};font-size:${size * pxPerMm}px;text-align:${align};white-space:${wraps ? 'pre-wrap' : 'pre'};overflow-wrap:${wraps ? 'anywhere' : 'normal'}`;
  }
  const registeredFonts = new Set<string>();
  /** An embedded face is only a byte array until it is registered, so the canvas would otherwise preview every label in the fallback font. */
  async function registerFonts(fonts: FontResource[]) {
    if (typeof FontFace !== 'function' || typeof document === 'undefined') return;
    for (const font of fonts) {
      if (registeredFonts.has(font.id)) continue;
      registeredFonts.add(font.id);
      try {
        const face = new FontFace(font.family, `url(data:${font.mimeType};base64,${font.data})`, {
          weight: String(font.weight),
          style: font.style,
        });
        document.fonts.add(await face.load());
        fontGeneration += 1;
        lineWidths.clear();
      } catch {
        registeredFonts.delete(font.id);
      }
    }
  }
  let fontGeneration = $state(0);
  $effect(() => {
    const fonts = editor.document.fonts;
    untrack(() => registerFonts(fonts)).catch(() => {});
  });
  const selectionBounds = $derived(
    boundsOf(
      displayDocument.elements.filter(
        (item) => editor.selection.has(item.id) && !isEffectivelyLocked(displayDocument, item),
      ),
      displayDocument,
    ),
  );
  const rotateElement = $derived(
    editor.selectedElements.length === 1 && editor.selectedElements[0].type !== 'group'
      ? editor.selectedElements[0]
      : undefined,
  );
  const rollSettings = $derived(continuousSettings(editor.document));
  // The SDK preview depends on the document, printer and SDK only; selection, pan and zoom must not re-run it.
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewInputs: [LabelDocument, string | undefined, PrinterSdk | undefined] | undefined;
  $effect(() => {
    const document = editor.document;
    const printerId = printer?.id;
    const currentSdk = sdk;
    untrack(() => schedulePreview(document, printerId, currentSdk));
  });
  function schedulePreview(document: LabelDocument, printerId: string | undefined, currentSdk: PrinterSdk | undefined) {
    if (
      previewInputs &&
      previewInputs[0] === document &&
      previewInputs[1] === printerId &&
      previewInputs[2] === currentSdk
    )
      return;
    previewInputs = [document, printerId, currentSdk];
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = undefined;
      void preparePreview();
    }, 120);
  }
  onDestroy(() => {
    if (previewTimer) clearTimeout(previewTimer);
    cancelPendingMove();
  });
  const displayHeight = $derived(previewDocument?.media.height ?? editor.document.media.height);
  /** Ruler ticks follow the pan and zoom so the scale stays honest; the label origin is where the media's top-left lands on screen. */
  const rulerOrigin = $derived(
    labelToScreen({ x: 0, y: 0 }, editor.view, { width: editor.document.media.width, height: displayHeight }),
  );
  const horizontalTicks = $derived(
    rulerTicks(editor.view.zoom, rulerOrigin.x - RULER_SIZE, Math.max(0, editor.view.viewport.width - RULER_SIZE)),
  );
  /** Where the floating selection bar sits: above the selection, clear of the handles that overhang the top edge. */
  const selectionAnchor = $derived.by(() => {
    const bounds = selectionBounds ?? { x: 0, y: 0, width: 0, height: 0 };
    const media = { width: editor.document.media.width, height: displayHeight };
    const clearance = 6 * editor.view.zoom + 8;
    const top = labelToScreen({ x: bounds.x + bounds.width / 2, y: bounds.y }, editor.view, media);
    const bottom = labelToScreen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, editor.view, media);
    return { above: { x: top.x, y: top.y - clearance }, below: { x: bottom.x, y: bottom.y + clearance } };
  });
  /** Text element being edited in place, with its draft. The textarea lives in the unscaled chrome layer over the element. */
  let editingText = $state<string | undefined>();
  let textDraft = $state('');
  const editingElement = $derived(
    editingText
      ? (editor.document.elements.find((item) => item.id === editingText && item.type === 'text') as
          Extract<LabelElement, { type: 'text' }> | undefined)
      : undefined,
  );
  const editingRect = $derived.by(() => {
    const element = editingElement;
    if (!element) return undefined;
    const media = { width: editor.document.media.width, height: displayHeight };
    const root = elementRootBounds(editor.document, element);
    const origin = labelToScreen({ x: root.x, y: root.y }, editor.view, media);
    return {
      left: origin.x,
      top: origin.y,
      width: root.width * PX_PER_MM * editor.view.zoom,
      height: root.height * PX_PER_MM * editor.view.zoom,
    };
  });
  function startTextEdit(element: LabelElement) {
    if (element.type !== 'text') return;
    editingText = element.id;
    textDraft = element.text;
    editor.select([element.id]);
    requestAnimationFrame(() => {
      const area = document.querySelector<HTMLTextAreaElement>('textarea.inline-edit');
      area?.focus();
      area?.select();
    });
  }
  function commitTextEdit() {
    const id = editingText;
    if (!id) return;
    editingText = undefined;
    const element = editor.document.elements.find((item) => item.id === id);
    if (element?.type === 'text' && element.text !== textDraft) editor.execute(patchElement(id, { text: textDraft }));
  }
  function textEditKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      editingText = undefined;
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commitTextEdit();
    }
  }
  /** Double-click edits a text element that is already selectable on its own; inside a group it first selects the child. */
  function activateElement(event: MouseEvent, element: LabelElement) {
    if (element.type === 'text' && (!element.groupId || editor.selection.has(element.id))) {
      event.stopPropagation();
      startTextEdit(element);
    } else enterElement(event, element);
  }
  /** Screen anchors for the informational chrome, which is not scaled with the label. */
  const chromeAt = $derived((point: { x: number; y: number }) =>
    labelToScreen(point, editor.view, { width: editor.document.media.width, height: displayHeight }),
  );
  const verticalTicks = $derived(
    rulerTicks(editor.view.zoom, rulerOrigin.y - RULER_SIZE, Math.max(0, editor.view.viewport.height - RULER_SIZE)),
  );
  async function preparePreview() {
    const generation = ++previewGeneration;
    if (!sdk) {
      previewDocument = undefined;
      previewError = '';
      previewWarning = '';
      return;
    }
    try {
      const continuous = printer?.continuousMedia;
      const prepared = await prepareDocumentForOutput(
        editor.document,
        {
          materializer,
          measurer: sdk.measure ? (sdk as import('../continuous-media.js').DocumentMeasurer) : undefined,
        },
        {
          limits: printer
            ? {
                minimumLengthMm: continuous?.minimumLengthMm ?? printer.media.minHeight,
                maximumLengthMm: continuous?.maximumLengthMm ?? printer.media.maxHeight,
                source: 'printer',
                printerModel: printer.id,
              }
            : undefined,
        },
      );
      if (generation === previewGeneration) {
        previewDocument = prepared.document;
        previewError = '';
        const warnings = prepared.warnings.filter((item) => item.severity === 'warning').map((item) => item.message);
        if (
          rollSettings.lengthMode === 'fixed' &&
          prepared.contentBounds &&
          prepared.contentBounds.y + prepared.contentBounds.height > prepared.resolvedLengthMm &&
          !warnings.some((item) => item.includes('fixed cut line'))
        )
          warnings.push('Visible content extends past the fixed cut line.');
        previewWarning = warnings.join(' ');
      }
    } catch (error) {
      if (generation === previewGeneration) {
        previewDocument = undefined;
        previewWarning = '';
        previewError = error instanceof Error ? error.message : String(error);
        console.error('Label preview failed', error);
      }
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={viewportElement}
  class="viewport"
  class:with-rulers={editor.view.showRulers}
  class:armed={!!editor.tool}
  onclick={clearSelection}
  onwheel={wheel}
  onpointerdown={gestureStart}
  onpointermove={moveDrag}
  onpointerleave={() => (editor.pointer = undefined)}
  onpointerup={gestureEnd}
  onpointercancel={cancelInteraction}
  role="application"
  aria-label="Label canvas"
>
  {#if editor.view.showRulers}
    <div class="ruler horizontal" aria-hidden="true">
      <svg width="100%" height={RULER_SIZE}>
        {#each horizontalTicks as tick (tick.mm)}
          <line x1={tick.at} x2={tick.at} y1={tick.major ? 6 : 13} y2={RULER_SIZE} />
          {#if tick.label !== undefined}<text x={tick.at + 2} y={9}>{tick.label}</text>{/if}
        {/each}
      </svg>
    </div>
    <div class="ruler vertical" aria-hidden="true">
      <svg width={RULER_SIZE} height="100%">
        {#each verticalTicks as tick (tick.mm)}
          <line y1={tick.at} y2={tick.at} x1={tick.major ? 6 : 13} x2={RULER_SIZE} />
          {#if tick.label !== undefined}<text x={2} y={tick.at - 2} transform={`rotate(-90 2 ${tick.at - 2})`}
              >{tick.label}</text
            >{/if}
        {/each}
      </svg>
    </div>
    <div class="ruler corner" aria-hidden="true">mm</div>
  {/if}
  <div
    class="pan"
    style={`transform:translate(calc(-50% + ${editor.view.pan.x}px),calc(-50% + ${editor.view.pan.y}px)) scale(${editor.view.zoom})`}
  >
    <!-- Painted before the label so it sits behind it without a negative z-index. -->
    {#if editor.document.media.shape === 'continuous'}<div
        class="roll-continuation"
        style={`top:${displayHeight * pxPerMm}px;width:${editor.document.media.width * pxPerMm}px`}
        aria-hidden="true"
      >
        <span>continuous roll</span>
      </div>{/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:this={mediaElement}
      class:drop-target={!!assetDrag.current}
      ondragover={assetDragOver}
      ondrop={assetDrop}
      class:grid={editor.view.showGrid}
      class:continuous={editor.document.media.shape === 'continuous'}
      class:round={editor.document.media.shape === 'round'}
      class="media"
      style={`width:${editor.document.media.width * pxPerMm}px;height:${displayHeight * pxPerMm}px;--grid:${editor.view.gridSize * pxPerMm}px`}
    >
      {#if editor.document.media.shape === 'continuous'}<div
          class="safe-margin leading"
          style={`height:${rollSettings.leadingMarginMm * pxPerMm}px`}
        ></div>
        <div class="safe-margin trailing" style={`height:${rollSettings.trailingMarginMm * pxPerMm}px`}></div>
        <div class="cut-line"><span class="visually-hidden">Cut at {displayHeight.toFixed(2)} mm</span></div>{/if}
      {#if sdk && previewDocument}<ThermalPreview {sdk} document={previewDocument} zoom={editor.view.zoom} />{/if}
      <div class="elements">
        {#each sortedElements as element, rank (element.id)}
          {#if element.type !== 'group' && isEffectivelyVisible(displayDocument, element)}
            <button
              type="button"
              class:selected={editor.selection.has(element.id)}
              class:locked={isEffectivelyLocked(displayDocument, element)}
              class:exact={!!sdk}
              class="element {element.type}"
              data-id={element.id}
              style={styleFor(
                element,
                elementRootOffset(displayDocument, element),
                movesWithDrag(element) ? dragPreviewDelta : undefined,
                rank,
              )}
              onpointerdown={(event) => startDrag(event, element)}
              onpointerup={finishDrag}
              ondblclick={(event) => activateElement(event, element)}
              aria-label={element.name}
            >
              {#if element.type === 'text'}<span style={textBoxStyle(element)}
                  ><span class="text-body" style={textStyle(element, fontGeneration)}>{merged(element.text)}</span
                  ></span
                >
              {:else if element.type === 'barcode'}<span class="placeholder">▥ {merged(element.value)}</span>
              {:else if element.type === 'qr'}<span class="placeholder">▦</span>
              {:else if element.type === 'image' || element.type === 'svg'}
                {@const resource = resourcesById.get(element.resourceId)}
                {#if resource}<img
                    class="asset"
                    style={`object-fit:${element.type === 'image' && element.fit === 'stretch' ? 'fill' : element.type === 'image' && element.fit === 'cover' ? 'cover' : 'contain'};filter:${element.type === 'image' && element.invert ? 'invert(1)' : 'none'}`}
                    alt={element.name}
                    src={resourceUrl(resource)}
                  />{:else}<span class="placeholder">Missing asset</span>{/if}
              {:else}<span class="placeholder">{element.type}</span>{/if}
            </button>
          {/if}
        {/each}
      </div>
      {#if selectionBounds}<div
          class="selection-box"
          style={`${boundsStyle(selectionBounds, drag?.kind === 'move' ? dragPreviewDelta : undefined)};--inverse-zoom:${1 / editor.view.zoom}`}
        >
          {#if selectionHasGroup}<div
              class="selection-move"
              role="presentation"
              title="Drag to move the group; double-click a child to edit it alone"
              onpointerdown={startSelectionDrag}
              onpointerup={finishDrag}
              ondblclick={enterUnderPointer}
            ></div>{/if}{#each resizeHandles as handle}<i
              class="handle resize {handle}"
              role="presentation"
              title={`Resize ${handle}; hold Shift to toggle aspect ratio`}
              onpointerdown={(event) => startResize(event, handle)}
              onpointerup={finishDrag}
            ></i>{/each}{#if rotateElement}<i
              class="handle rotate"
              role="presentation"
              title="Rotate; hold Shift for 15° increments"
              onpointerdown={(event) => startRotate(event, rotateElement!)}
              onpointerup={finishDrag}>↻</i
            >{/if}
        </div>{/if}
      {#each [...editor.view.manualGuides, ...editor.view.guides] as guide, index (index)}<div
          class="guide {guide.axis}"
          style={`${guide.axis === 'x' ? 'left' : 'top'}:${guide.value * pxPerMm}px`}
        ></div>{/each}
    </div>
  </div>
  <div class="chrome" aria-live="polite">
    {#if draw}
      <span
        class="draw-preview"
        style={`left:${Math.min(draw.at.x, draw.current.x)}px;top:${Math.min(draw.at.y, draw.current.y)}px;width:${Math.abs(draw.current.x - draw.at.x)}px;height:${Math.abs(draw.current.y - draw.at.y)}px`}
      ></span>
    {/if}
    {#if editor.document.media.shape === 'continuous'}
      {@const cut = chromeAt({ x: editor.document.media.width, y: displayHeight })}
      <span class="cut-label" style={`left:${cut.x}px;top:${cut.y}px`}>Cut at {displayHeight.toFixed(2)} mm</span>
    {/if}
    {#if editor.document.template?.records.length}
      {@const origin = chromeAt({ x: 0, y: 0 })}
      <span
        class="record-badge mb-badge busy"
        role="status"
        style={`left:${origin.x + 6}px;top:${origin.y + 6}px`}
        title="Values from this record are shown; pick another row in the Data tab"
        >Record {editor.document.template.currentRecord + 1} of {editor.document.template.records.length}</span
      >
    {/if}
    {#if previewWarning}
      {@const corner = chromeAt({ x: 0, y: displayHeight })}
      <span
        class="preview-warning"
        role="status"
        style={`left:${corner.x + 6}px;top:${corner.y - 6}px`}
        title={previewWarning}>{previewWarning}</span
      >
    {/if}
    {#if previewError && !previewDocument}
      {@const corner = chromeAt({ x: editor.document.media.width, y: displayHeight })}
      <span
        class="preview-error"
        role="alert"
        style={`left:${corner.x - 6}px;top:${corner.y - 6}px`}
        title={previewError}
        >Fit preview unavailable: {previewError.length > 90 ? `${previewError.slice(0, 89)}…` : previewError}</span
      >
    {/if}
    {#if !editor.document.elements.length}
      <p class="empty-hint">Add text or a shape from the tools on the left, or drop an asset here.</p>
    {/if}
    {#if editingRect}
      <textarea
        class="inline-edit"
        aria-label="Edit text"
        style={`left:${editingRect.left}px;top:${editingRect.top}px;width:${editingRect.width}px;height:${editingRect.height}px;font-size:${(editingElement?.fontSize ?? 4) * PX_PER_MM * editor.view.zoom}px`}
        value={textDraft}
        oninput={(event) => (textDraft = event.currentTarget.value)}
        onblur={commitTextEdit}
        onkeydown={textEditKeys}></textarea>
    {/if}
  </div>
  {#if selectionBounds && !drag}
    <SelectionBar
      {editor}
      above={selectionAnchor.above}
      below={selectionAnchor.below}
      viewport={editor.view.viewport}
      {compact}
    />
  {/if}
  <ZoomControl {editor} />
</div>

<style>
  .viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    background: var(--mble-surface-sunken);
    touch-action: none;
  }
  .pan {
    position: absolute;
    left: 50%;
    top: 50%;
    transform-origin: center;
  }
  .media {
    position: relative;
    isolation: isolate;
    border-radius: 3px;
    background: var(--mble-paper);
    box-shadow: var(--mble-shadow);
    overflow: hidden;
  }
  .media.grid {
    background-image:
      linear-gradient(var(--grid-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
    --grid-line: color-mix(in srgb, var(--mble-guide) 14%, transparent);
    background-size: var(--grid) var(--grid);
  }
  /* Elements stack among themselves only; the wrapper lets pointer events reach the label behind them. */
  .elements {
    position: absolute;
    inset: 0;
    z-index: 1;
    isolation: isolate;
    pointer-events: none;
  }
  .element {
    position: absolute;
    pointer-events: auto;
    margin: 0;
    padding: 0;
    overflow: visible;
    border: 1px dashed transparent;
    background: transparent;
    color: var(--mble-ink);
    transform-origin: center;
    cursor: move;
  }
  .element:hover {
    background: transparent;
  }
  .element:not(.selected):hover {
    border-color: var(--mble-border-strong);
  }
  .element.selected {
    border-color: var(--mble-primary);
    outline: 1px solid var(--mble-paper);
  }
  .element.locked {
    cursor: not-allowed;
  }
  .element span {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .element span.text-body {
    display: block;
    width: 100%;
    height: auto;
    overflow: hidden;
  }
  .selection-box {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--mble-primary);
    outline: 1px solid var(--mble-paper);
    pointer-events: none;
    z-index: var(--mble-z-canvas-chrome);
  }
  .selection-move {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    cursor: move;
  }
  .handle {
    position: absolute;
    display: block;
    box-sizing: content-box;
    width: 8px;
    height: 8px;
    background: var(--mble-paper);
    border: 1px solid var(--mble-primary);
    pointer-events: auto;
    z-index: 1;
    /* Handles keep their screen size at any zoom and carry a hit area larger than they look. */
    transform: scale(var(--inverse-zoom, 1));
  }
  .handle::before {
    content: '';
    position: absolute;
    inset: -4px;
  }
  @media (pointer: coarse) {
    .handle::before {
      inset: -12px;
    }
  }
  .handle.resize.nw {
    left: -5px;
    top: -5px;
    cursor: nwse-resize;
  }
  .handle.resize.n {
    left: calc(50% - 5px);
    top: -5px;
    cursor: ns-resize;
  }
  .handle.resize.ne {
    right: -5px;
    top: -5px;
    cursor: nesw-resize;
  }
  .handle.resize.e {
    right: -5px;
    top: calc(50% - 5px);
    cursor: ew-resize;
  }
  .handle.resize.se {
    right: -5px;
    bottom: -5px;
    cursor: nwse-resize;
  }
  .handle.resize.s {
    left: calc(50% - 5px);
    bottom: -5px;
    cursor: ns-resize;
  }
  .handle.resize.sw {
    left: -5px;
    bottom: -5px;
    cursor: nesw-resize;
  }
  .handle.resize.w {
    left: -5px;
    top: calc(50% - 5px);
    cursor: ew-resize;
  }
  .handle.rotate {
    top: -18px;
    left: calc(50% - 5px);
    cursor: grab;
    font-size: var(--mble-text-micro);
    line-height: 8px;
    color: var(--mble-text);
  }
  .rectangle,
  .ellipse,
  .triangle {
    border: 1px solid var(--mble-ink);
  }
  .ellipse {
    border-radius: 50%;
  }
  .triangle {
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
    background: var(--mble-ink);
  }
  .line {
    background: var(--mble-ink);
  }
  .placeholder {
    font-size: var(--mble-text-micro);
  }
  .ruler {
    position: absolute;
    background: var(--mble-surface-muted);
    z-index: var(--mble-z-canvas-chrome);
  }
  .ruler.horizontal {
    height: 20px;
    left: 20px;
    right: 0;
    border-bottom: 1px solid var(--mble-border-strong);
  }
  .ruler.vertical {
    width: 20px;
    top: 20px;
    bottom: 0;
    border-right: 1px solid var(--mble-border-strong);
  }
  .ruler.corner {
    top: 0;
    left: 0;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
    border-right: 1px solid var(--mble-border-strong);
    border-bottom: 1px solid var(--mble-border-strong);
  }
  .ruler svg {
    display: block;
    overflow: visible;
  }
  .ruler line {
    stroke: var(--mble-text-muted);
    stroke-width: 1;
    shape-rendering: crispEdges;
  }
  .ruler text {
    fill: var(--mble-text-muted);
    font-size: var(--mble-text-micro);
    font-variant-numeric: tabular-nums;
  }
  .guide {
    position: absolute;
    background: var(--mble-guide);
    pointer-events: none;
  }
  .guide.x {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .guide.y {
    left: 0;
    right: 0;
    height: 1px;
  }
  .element.exact:not(.selected) span,
  .element.exact:not(.selected) .asset {
    visibility: hidden;
  }
  .asset {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .media.drop-target {
    outline: 2px dashed var(--mble-primary);
    outline-offset: 2px;
  }
  .media.round {
    border-radius: 50%;
  }
  .media.continuous {
    border-radius: 3px 3px 0 0;
  }
  .safe-margin {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    pointer-events: none;
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--mble-guide) 7%, transparent) 0 4px,
      color-mix(in srgb, var(--mble-guide) 16%, transparent) 4px 5px
    );
  }
  .safe-margin.leading {
    top: 0;
    border-bottom: 1px dotted var(--mble-guide);
  }
  .safe-margin.trailing {
    bottom: 0;
    border-top: 1px dotted var(--mble-guide);
  }
  .cut-line {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    z-index: var(--mble-z-canvas-chrome);
    border-bottom: 2px dashed var(--mble-danger);
    pointer-events: none;
  }
  .roll-continuation {
    position: absolute;
    left: 0;
    height: 56px;
    border: 1px solid var(--mble-border-strong);
    border-top: 0;
    background:
      linear-gradient(
        color-mix(in srgb, var(--mble-paper) 80%, transparent),
        color-mix(in srgb, var(--mble-paper) 25%, transparent)
      ),
      repeating-linear-gradient(90deg, transparent 0 8px, color-mix(in srgb, var(--mble-ink) 9%, transparent) 8px 9px);
    box-sizing: border-box;
    box-shadow: var(--mble-shadow);
    color: var(--mble-text-muted);
    text-align: center;
    font-size: var(--mble-text-micro);
    pointer-events: none;
  }
  .roll-continuation span {
    display: block;
    margin-top: 30px;
    opacity: 0.65;
  }
  .chrome {
    position: absolute;
    inset: 0;
    z-index: calc(var(--mble-z-canvas-chrome) + 1);
    pointer-events: none;
    font-size: var(--mble-text-micro);
  }
  .viewport.armed {
    cursor: crosshair;
  }
  .draw-preview {
    box-sizing: border-box;
    border: 1px dashed var(--mble-primary);
    background: color-mix(in srgb, var(--mble-primary) 12%, transparent);
  }
  .chrome > span {
    position: absolute;
    max-width: 40%;
    padding: 2px 5px;
    border-radius: var(--mble-radius-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cut-label {
    transform: translate(-100%, -100%);
    background: var(--mble-surface);
    color: var(--mble-danger);
  }
  .preview-warning {
    transform: translateY(-100%);
    background: var(--mble-warning-tint);
    color: var(--mble-danger);
  }
  .preview-error {
    transform: translate(-100%, -100%);
    max-width: min(32rem, 90%);
    background: var(--mble-surface);
    color: var(--mble-danger);
    white-space: normal;
  }
  .empty-hint {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: 18rem;
    margin: 0;
    transform: translate(-50%, -50%);
    text-align: center;
    color: var(--mble-text-muted);
    font-size: var(--mble-text-body);
  }
  .inline-edit {
    position: absolute;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    border: 1px solid var(--mble-primary);
    background: var(--mble-paper);
    color: var(--mble-ink);
    font-family: inherit;
    line-height: 1.2;
    resize: none;
    pointer-events: auto;
    z-index: calc(var(--mble-z-canvas-chrome) + 3);
  }
</style>
