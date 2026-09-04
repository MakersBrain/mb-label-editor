// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bounds, LabelDocument, LabelElement, Point, Zone } from './model.js';
import { isEffectivelyVisible } from './model.js';
import { elementRootBounds } from './zones.js';

export type SnapMode = 'all' | 'grid' | 'elements' | 'none';
export interface SnapOptions {
  grid: number;
  threshold: number;
  gridEnabled: boolean;
  guides: { axis: 'x' | 'y'; value: number }[];
  zones?: Zone[];
  mode?: SnapMode;
}
export interface SnapResult {
  delta: Point;
  guides: { axis: 'x' | 'y'; value: number }[];
}
/**
 * Everything about a drag that does not change while the pointer moves: the
 * moving selection's bounding box and every candidate target, grouped by
 * source so the modifier-selected mode can still be applied per event.
 */
export interface SnapTargets {
  moving: Bounds | undefined;
  media: { x: number[]; y: number[] };
  elements: { x: number[]; y: number[] };
  zones: { x: number[]; y: number[] };
  guides: { x: number[]; y: number[] };
}

/** Computes the snap targets once, at the start of a drag. */
export function snapTargets(
  elements: LabelElement[],
  selected: Set<string>,
  media: Bounds,
  options: Pick<SnapOptions, 'guides' | 'zones'>,
  document?: LabelDocument,
): SnapTargets {
  const movingIds = expandSelectedGroups(elements, selected);
  const moving = elements.filter((item) => movingIds.has(item.id));
  const rootBounds = (item: LabelElement): Bounds => (document ? elementRootBounds(document, item) : item.transform);
  const movingBounds = moving.map(rootBounds);
  const stationary = elements.filter(
    (item) =>
      !movingIds.has(item.id) &&
      (document ? isEffectivelyVisible(document, item) : item.visible) &&
      item.type !== 'group',
  );
  const zones = options.zones ?? [];
  const edges = (bounds: Bounds, axis: 'x' | 'y') =>
    axis === 'x'
      ? [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width]
      : [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height];
  const stationaryBounds = stationary.map(rootBounds);
  return {
    moving: moving.length
      ? {
          x: Math.min(...movingBounds.map((item) => item.x)),
          y: Math.min(...movingBounds.map((item) => item.y)),
          width:
            Math.max(...movingBounds.map((item) => item.x + item.width)) -
            Math.min(...movingBounds.map((item) => item.x)),
          height:
            Math.max(...movingBounds.map((item) => item.y + item.height)) -
            Math.min(...movingBounds.map((item) => item.y)),
        }
      : undefined,
    media: { x: edges(media, 'x'), y: edges(media, 'y') },
    elements: {
      x: stationaryBounds.flatMap((bounds) => edges(bounds, 'x')),
      y: stationaryBounds.flatMap((bounds) => edges(bounds, 'y')),
    },
    zones: { x: zones.flatMap((zone) => edges(zone, 'x')), y: zones.flatMap((zone) => edges(zone, 'y')) },
    guides: {
      x: options.guides.filter((guide) => guide.axis === 'x').map((guide) => guide.value),
      y: options.guides.filter((guide) => guide.axis === 'y').map((guide) => guide.value),
    },
  };
}

/** Snaps a proposed delta against precomputed targets; cheap enough to run on every pointer move. */
export function snapWithTargets(
  targets: SnapTargets,
  delta: Point,
  options: Pick<SnapOptions, 'grid' | 'gridEnabled' | 'threshold' | 'mode'>,
): SnapResult {
  const mode = options.mode ?? 'all';
  if (mode === 'none' || !targets.moving) return { delta, guides: [] };
  const { moving } = targets;
  const x0 = moving.x;
  const x1 = moving.x + moving.width;
  const y0 = moving.y;
  const y1 = moving.y + moving.height;
  const allTargets = mode === 'all';
  const elementTargets = mode === 'elements' || allTargets;
  const xTargets = [
    ...(allTargets ? targets.media.x : []),
    ...(elementTargets ? targets.elements.x : []),
    ...(allTargets ? targets.zones.x : []),
    ...(allTargets ? targets.guides.x : []),
  ];
  const yTargets = [
    ...(allTargets ? targets.media.y : []),
    ...(elementTargets ? targets.elements.y : []),
    ...(allTargets ? targets.zones.y : []),
    ...(allTargets ? targets.guides.y : []),
  ];
  const snapAxis = (edges: number[], candidates: number[], proposed: number) => {
    let correction = 0;
    let guide: number | undefined;
    let distance = options.threshold;
    for (const edge of edges)
      for (const target of candidates) {
        const candidate = target - (edge + proposed);
        if (Math.abs(candidate) <= distance) {
          distance = Math.abs(candidate);
          correction = candidate;
          guide = target;
        }
      }
    return { value: proposed + correction, guide };
  };
  let x = delta.x;
  let y = delta.y;
  const guides: SnapResult['guides'] = [];
  if ((mode === 'grid' || allTargets) && options.gridEnabled && options.grid > 0) {
    x = Math.round((x0 + x) / options.grid) * options.grid - x0;
    y = Math.round((y0 + y) / options.grid) * options.grid - y0;
  }
  const sx = xTargets.length ? snapAxis([x0, (x0 + x1) / 2, x1], xTargets, x) : { value: x, guide: undefined };
  const sy = yTargets.length ? snapAxis([y0, (y0 + y1) / 2, y1], yTargets, y) : { value: y, guide: undefined };
  if (sx.guide !== undefined) guides.push({ axis: 'x', value: sx.guide });
  if (sy.guide !== undefined) guides.push({ axis: 'y', value: sy.guide });
  return { delta: { x: sx.value, y: sy.value }, guides };
}

export function snapMove(
  elements: LabelElement[],
  selected: Set<string>,
  delta: Point,
  media: Bounds,
  options: SnapOptions,
  document?: LabelDocument,
): SnapResult {
  return snapWithTargets(snapTargets(elements, selected, media, options, document), delta, options);
}
export const mediaBounds = (document: LabelDocument): Bounds => ({
  x: 0,
  y: 0,
  width: document.media.width,
  height: document.media.height,
});
export const guidesEqual = (a: SnapResult['guides'], b: SnapResult['guides']): boolean =>
  a.length === b.length && a.every((guide, index) => guide.axis === b[index].axis && guide.value === b[index].value);

/** Alt disables snapping, Ctrl/Cmd isolates element snapping, and Shift isolates the grid. */
export function snapModeForModifiers(
  modifiers: Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): SnapMode {
  if (modifiers.altKey) return 'none';
  if (modifiers.ctrlKey || modifiers.metaKey) return 'elements';
  if (modifiers.shiftKey) return 'grid';
  return 'all';
}

function expandSelectedGroups(elements: LabelElement[], selected: Set<string>): Set<string> {
  const byId = new Map(elements.map((item) => [item.id, item]));
  const expanded = new Set(selected);
  const include = (id: string) => {
    const item = byId.get(id);
    if (!item || item.type !== 'group') return;
    for (const childId of item.childIds) {
      if (expanded.has(childId)) continue;
      expanded.add(childId);
      include(childId);
    }
  };
  for (const id of selected) include(id);
  return expanded;
}
