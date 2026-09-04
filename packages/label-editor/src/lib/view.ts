// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bounds, Point } from './model.js';

/** CSS pixels per millimetre at 100% zoom (96 dpi). */
export const PX_PER_MM = 3.7795275591;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
/** Multiplicative step for zoom in and out, so 100% goes 125%, 156%, 195%. */
export const ZOOM_STEP = 1.25;
export const zoomPresets = [0.5, 1, 2, 4] as const;
/** Width of the ruler gutters in CSS pixels. */
export const RULER_SIZE = 20;

export interface MediaSize {
  width: number;
  height: number;
}
export interface ViewportSize {
  width: number;
  height: number;
}
/** The parts of the view that place the label on screen. */
export interface ViewPlacement {
  zoom: number;
  pan: Point;
  viewport: ViewportSize;
}

export const clampZoom = (zoom: number): number =>
  Number.isFinite(zoom) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) : 1;

/**
 * Zoom and pan that show the whole label inside the viewport with a margin.
 * The canvas centres the label on the viewport, so the pan only compensates
 * for the ruler gutters, which sit on the top and left edges.
 */
export function fitToView(
  media: MediaSize,
  viewport: ViewportSize,
  options: { paddingPx?: number; rulerInset?: number } = {},
): { zoom: number; pan: Point } {
  const padding = options.paddingPx ?? 48;
  const inset = options.rulerInset ?? 0;
  const availableWidth = Math.max(1, viewport.width - inset - padding * 2);
  const availableHeight = Math.max(1, viewport.height - inset - padding * 2);
  const zoom = clampZoom(
    Math.min(availableWidth / (media.width * PX_PER_MM), availableHeight / (media.height * PX_PER_MM)),
  );
  return { zoom, pan: { x: inset / 2, y: inset / 2 } };
}

/** Screen position (relative to the viewport's top-left) of a label point in millimetres. */
export function labelToScreen(point: Point, view: ViewPlacement, media: MediaSize): Point {
  return {
    x: view.viewport.width / 2 + view.pan.x + (point.x - media.width / 2) * PX_PER_MM * view.zoom,
    y: view.viewport.height / 2 + view.pan.y + (point.y - media.height / 2) * PX_PER_MM * view.zoom,
  };
}

/** Label point in millimetres under a screen position relative to the viewport's top-left. */
export function screenToLabel(point: Point, view: ViewPlacement, media: MediaSize): Point {
  return {
    x: (point.x - view.viewport.width / 2 - view.pan.x) / (PX_PER_MM * view.zoom) + media.width / 2,
    y: (point.y - view.viewport.height / 2 - view.pan.y) / (PX_PER_MM * view.zoom) + media.height / 2,
  };
}

/** The part of the label currently visible, or the whole label when the viewport size is unknown or nothing overlaps. */
export function visibleLabelArea(view: ViewPlacement, media: MediaSize): Bounds {
  const whole = { x: 0, y: 0, width: media.width, height: media.height };
  if (!view.viewport.width || !view.viewport.height) return whole;
  const topLeft = screenToLabel({ x: 0, y: 0 }, view, media);
  const bottomRight = screenToLabel({ x: view.viewport.width, y: view.viewport.height }, view, media);
  const x = Math.max(0, topLeft.x);
  const y = Math.max(0, topLeft.y);
  const right = Math.min(media.width, bottomRight.x);
  const bottom = Math.min(media.height, bottomRight.y);
  if (right <= x || bottom <= y) return whole;
  return { x, y, width: right - x, height: bottom - y };
}

export interface RulerTick {
  /** Position along the ruler in CSS pixels from its start. */
  at: number;
  /** Position in label millimetres. */
  mm: number;
  major: boolean;
  label?: string;
}

/**
 * Tick marks for a ruler of `lengthPx` pixels whose label origin sits at
 * `originPx` from the ruler's start. The minor spacing is the smallest of
 * 1, 2, 5, 10, 20 or 50 mm that leaves at least 6 px between ticks, and every
 * fifth tick is major and labelled, so rulers stay readable at any zoom.
 */
export function rulerTicks(zoom: number, originPx: number, lengthPx: number): RulerTick[] {
  const pxPerMm = PX_PER_MM * zoom;
  const spacing = [1, 2, 5, 10, 20, 50].find((step) => step * pxPerMm >= 6) ?? 100;
  const ticks: RulerTick[] = [];
  if (!(lengthPx > 0) || !Number.isFinite(pxPerMm) || pxPerMm <= 0) return ticks;
  // `|| 0` turns a negative zero from Math.floor into a plain zero so labels and keys read as 0.
  const first = Math.floor(-originPx / pxPerMm / spacing) * spacing || 0;
  const last = Math.ceil((lengthPx - originPx) / pxPerMm / spacing) * spacing;
  for (let mm = first; mm <= last; mm += spacing) {
    const at = originPx + mm * pxPerMm;
    if (at < 0 || at > lengthPx) continue;
    const major = Math.round(mm / spacing) % 5 === 0;
    ticks.push({ at, mm, major, label: major ? String(mm) : undefined });
  }
  return ticks;
}
