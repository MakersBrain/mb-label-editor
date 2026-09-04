// SPDX-License-Identifier: AGPL-3.0-or-later
import { addElement } from './commands.js';
import { uuid, type Bounds, type LabelElement, type Point } from './model.js';
import type { EditorStore } from './store.svelte.js';
import { visibleLabelArea } from './view.js';

export const insertTypes = ['text', 'rectangle', 'ellipse', 'triangle', 'line', 'barcode', 'qr'] as const;
export type InsertType = (typeof insertTypes)[number];
/** Letter keys that arm a drawing tool from the keyboard. */
export const toolKeys: Partial<Record<InsertType, string>> = { rectangle: 'R', ellipse: 'E', text: 'T', line: 'L' };
export const toolForKey = (key: string): InsertType | undefined =>
  (Object.keys(toolKeys) as InsertType[]).find((type) => toolKeys[type] === key.toUpperCase());
export const insertLabels: Record<InsertType, string> = {
  text: 'Text',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  line: 'Line',
  barcode: 'Barcode',
  qr: 'QR',
};

export interface InsertSize {
  width: number;
  height: number;
}
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Where a new element goes: centred in the visible part of the label, and
 * cascaded by one grid step whenever an element of the same kind already sits
 * exactly there, so repeated inserts never pile up invisibly. The cascade wraps
 * back to the area's top-left when it would leave the area.
 */
export function insertPlacement(
  existing: LabelElement[],
  type: InsertType,
  size: InsertSize,
  area: Bounds,
  step: number,
): Point {
  const stride = step > 0 && Number.isFinite(step) ? step : 1;
  const clamp = (point: Point): Point => ({
    x: round(Math.min(Math.max(area.x, point.x), Math.max(area.x, area.x + area.width - size.width))),
    y: round(Math.min(Math.max(area.y, point.y), Math.max(area.y, area.y + area.height - size.height))),
  });
  const occupied = (point: Point) =>
    existing.some(
      (item) =>
        item.type === type &&
        Math.abs(item.transform.x - point.x) < 0.005 &&
        Math.abs(item.transform.y - point.y) < 0.005,
    );
  let at = clamp({ x: area.x + (area.width - size.width) / 2, y: area.y + (area.height - size.height) / 2 });
  for (let attempt = 0; attempt < 400 && occupied(at); attempt++) {
    const next = { x: at.x + stride, y: at.y + stride };
    const fits =
      next.x + size.width <= area.x + area.width + 0.005 && next.y + size.height <= area.y + area.height + 0.005;
    at = fits ? clamp(next) : clamp({ x: area.x + (attempt % 7) * stride, y: area.y });
  }
  return at;
}

const defaultSize = (type: InsertType): InsertSize => ({
  width: type === 'text' ? 25 : 12,
  height: type === 'text' ? 7 : 12,
});

/** Adds a default element of the requested kind at `at` (or a sensible free spot) and selects it. */
export function insertElement(
  editor: EditorStore,
  type: InsertType,
  options: { at?: Point; size?: InsertSize } = {},
): LabelElement {
  const size = options.size ?? defaultSize(type);
  const at =
    options.at ??
    insertPlacement(
      editor.document.elements,
      type,
      size,
      visibleLabelArea(editor.view, editor.document.media),
      editor.view.gridSize,
    );
  const base = {
    id: uuid(),
    name: insertLabels[type],
    transform: { x: at.x, y: at.y, width: size.width, height: size.height, rotation: 0 },
    zIndex: editor.document.elements.length,
    visible: true,
    locked: false,
  };
  let element: LabelElement;
  if (type === 'text')
    element = {
      ...base,
      type,
      text: 'Text',
      fontFamily: 'sans-serif',
      fontSize: 14,
      fontWeight: 400,
      horizontalAlign: 'left',
      verticalAlign: 'top',
      overflow: 'word-wrap',
    };
  else if (type === 'barcode') element = { ...base, type, value: '123456789', symbology: 'code128', showText: true };
  else if (type === 'qr') element = { ...base, type, value: 'https://makersbrain.com', errorCorrection: 'M' };
  else element = { ...base, type, strokeWidth: 0.3, filled: false };
  editor.execute(addElement(element));
  editor.select([element.id]);
  return element;
}
