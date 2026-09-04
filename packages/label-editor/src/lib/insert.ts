// SPDX-License-Identifier: AGPL-3.0-or-later
import { addElement } from './commands.js';
import { uuid, type LabelElement } from './model.js';
import type { EditorStore } from './store.svelte.js';

export const insertTypes = ['text', 'rectangle', 'ellipse', 'triangle', 'line', 'barcode', 'qr'] as const;
export type InsertType = (typeof insertTypes)[number];
export const insertLabels: Record<InsertType, string> = { text: 'Text', rectangle: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', line: 'Line', barcode: 'Barcode', qr: 'QR' };

/** Adds a default element of the requested kind and selects it. */
export function insertElement(editor: EditorStore, type: InsertType): LabelElement {
  const base = { id: uuid(), name: insertLabels[type], transform: { x: 5, y: 5, width: type === 'text' ? 25 : 12, height: type === 'text' ? 7 : 12, rotation: 0 }, zIndex: editor.document.elements.length, visible: true, locked: false };
  let element: LabelElement;
  if (type === 'text') element = { ...base, type, text: 'Text', fontFamily: 'sans-serif', fontSize: 14, fontWeight: 400, horizontalAlign: 'left', verticalAlign: 'top', overflow: 'word-wrap' };
  else if (type === 'barcode') element = { ...base, type, value: '123456789', symbology: 'code128', showText: true };
  else if (type === 'qr') element = { ...base, type, value: 'https://makersbrain.com', errorCorrection: 'M' };
  else element = { ...base, type, strokeWidth: .3, filled: false };
  editor.execute(addElement(element)); editor.select([element.id]); return element;
}
