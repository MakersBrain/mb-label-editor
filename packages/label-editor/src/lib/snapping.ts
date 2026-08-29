// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bounds, LabelDocument, LabelElement, Point } from './model.js';

export interface SnapOptions { grid: number; threshold: number; gridEnabled: boolean; guides: { axis: 'x' | 'y'; value: number }[] }
export interface SnapResult { delta: Point; guides: { axis: 'x' | 'y'; value: number }[] }
export function snapMove(elements: LabelElement[], selected: Set<string>, delta: Point, media: Bounds, options: SnapOptions): SnapResult {
  const moving = elements.filter((item) => selected.has(item.id)); if (!moving.length) return { delta, guides: [] };
  const x0 = Math.min(...moving.map((item) => item.transform.x)); const x1 = Math.max(...moving.map((item) => item.transform.x + item.transform.width));
  const y0 = Math.min(...moving.map((item) => item.transform.y)); const y1 = Math.max(...moving.map((item) => item.transform.y + item.transform.height));
  const stationary = elements.filter((item) => !selected.has(item.id) && item.visible);
  const xTargets = [media.x, media.x + media.width / 2, media.x + media.width, ...stationary.flatMap((item) => [item.transform.x, item.transform.x + item.transform.width / 2, item.transform.x + item.transform.width]), ...options.guides.filter((guide) => guide.axis === 'x').map((guide) => guide.value)];
  const yTargets = [media.y, media.y + media.height / 2, media.y + media.height, ...stationary.flatMap((item) => [item.transform.y, item.transform.y + item.transform.height / 2, item.transform.y + item.transform.height]), ...options.guides.filter((guide) => guide.axis === 'y').map((guide) => guide.value)];
  const snapAxis = (edges: number[], targets: number[], proposed: number) => { let correction = 0; let guide: number | undefined; let distance = options.threshold;
    for (const edge of edges) for (const target of targets) { const candidate = target - (edge + proposed); if (Math.abs(candidate) <= distance) { distance = Math.abs(candidate); correction = candidate; guide = target; } }
    return { value: proposed + correction, guide };
  };
  let x = delta.x; let y = delta.y; const guides: SnapResult['guides'] = [];
  if (options.gridEnabled && options.grid > 0) { x = Math.round((x0 + x) / options.grid) * options.grid - x0; y = Math.round((y0 + y) / options.grid) * options.grid - y0; }
  const sx = snapAxis([x0, (x0 + x1) / 2, x1], xTargets, x); const sy = snapAxis([y0, (y0 + y1) / 2, y1], yTargets, y);
  if (sx.guide !== undefined) guides.push({ axis: 'x', value: sx.guide }); if (sy.guide !== undefined) guides.push({ axis: 'y', value: sy.guide }); return { delta: { x: sx.value, y: sy.value }, guides };
}
export const mediaBounds = (document: LabelDocument): Bounds => ({ x: 0, y: 0, width: document.media.width, height: document.media.height });
