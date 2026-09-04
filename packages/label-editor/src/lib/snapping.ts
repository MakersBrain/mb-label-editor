// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bounds, LabelDocument, LabelElement, Point, Zone } from './model.js'; import { isEffectivelyVisible } from './model.js';
import { elementRootBounds } from './zones.js';

export type SnapMode = 'all' | 'grid' | 'elements' | 'none';
export interface SnapOptions { grid: number; threshold: number; gridEnabled: boolean; guides: { axis: 'x' | 'y'; value: number }[]; zones?: Zone[]; mode?: SnapMode }
export interface SnapResult { delta: Point; guides: { axis: 'x' | 'y'; value: number }[] }
export function snapMove(elements: LabelElement[], selected: Set<string>, delta: Point, media: Bounds, options: SnapOptions, document?: LabelDocument): SnapResult {
  const mode = options.mode ?? 'all';
  if (mode === 'none') return { delta, guides: [] };
  const movingIds = expandSelectedGroups(elements, selected);
  const moving = elements.filter((item) => movingIds.has(item.id)); if (!moving.length) return { delta, guides: [] };
  const rootBounds=(item:LabelElement):Bounds=>document?elementRootBounds(document,item):item.transform;
  const movingBounds=moving.map(rootBounds);
  const x0 = Math.min(...movingBounds.map((item) => item.x)); const x1 = Math.max(...movingBounds.map((item) => item.x + item.width));
  const y0 = Math.min(...movingBounds.map((item) => item.y)); const y1 = Math.max(...movingBounds.map((item) => item.y + item.height));
  const stationary = elements.filter((item) => !movingIds.has(item.id) && (document ? isEffectivelyVisible(document, item) : item.visible) && item.type !== 'group');
  const zones = options.zones ?? [];
  const allTargets = mode === 'all';
  const elementTargets = mode === 'elements' || allTargets;
  const xTargets = [
    ...(allTargets ? [media.x, media.x + media.width / 2, media.x + media.width] : []),
    ...(elementTargets ? stationary.flatMap((item) => {const bounds=rootBounds(item);return[bounds.x,bounds.x+bounds.width/2,bounds.x+bounds.width]}) : []),
    ...(allTargets ? zones.flatMap((zone) => [zone.x, zone.x + zone.width / 2, zone.x + zone.width]) : []),
    ...(allTargets ? options.guides.filter((guide) => guide.axis === 'x').map((guide) => guide.value) : [])
  ];
  const yTargets = [
    ...(allTargets ? [media.y, media.y + media.height / 2, media.y + media.height] : []),
    ...(elementTargets ? stationary.flatMap((item) => {const bounds=rootBounds(item);return[bounds.y,bounds.y+bounds.height/2,bounds.y+bounds.height]}) : []),
    ...(allTargets ? zones.flatMap((zone) => [zone.y, zone.y + zone.height / 2, zone.y + zone.height]) : []),
    ...(allTargets ? options.guides.filter((guide) => guide.axis === 'y').map((guide) => guide.value) : [])
  ];
  const snapAxis = (edges: number[], targets: number[], proposed: number) => { let correction = 0; let guide: number | undefined; let distance = options.threshold;
    for (const edge of edges) for (const target of targets) { const candidate = target - (edge + proposed); if (Math.abs(candidate) <= distance) { distance = Math.abs(candidate); correction = candidate; guide = target; } }
    return { value: proposed + correction, guide };
  };
  let x = delta.x; let y = delta.y; const guides: SnapResult['guides'] = [];
  if ((mode === 'grid' || allTargets) && options.gridEnabled && options.grid > 0) { x = Math.round((x0 + x) / options.grid) * options.grid - x0; y = Math.round((y0 + y) / options.grid) * options.grid - y0; }
  const sx = xTargets.length ? snapAxis([x0, (x0 + x1) / 2, x1], xTargets, x) : { value: x, guide: undefined };
  const sy = yTargets.length ? snapAxis([y0, (y0 + y1) / 2, y1], yTargets, y) : { value: y, guide: undefined };
  if (sx.guide !== undefined) guides.push({ axis: 'x', value: sx.guide }); if (sy.guide !== undefined) guides.push({ axis: 'y', value: sy.guide }); return { delta: { x: sx.value, y: sy.value }, guides };
}
export const mediaBounds = (document: LabelDocument): Bounds => ({ x: 0, y: 0, width: document.media.width, height: document.media.height });

/** Alt disables snapping, Ctrl/Cmd isolates element snapping, and Shift isolates the grid. */
export function snapModeForModifiers(modifiers: Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): SnapMode {
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
