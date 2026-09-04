// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument, LabelElement } from './model.js';

export type LayerIcon =
  'text' | 'rectangle' | 'ellipse' | 'triangle' | 'line' | 'barcode' | 'qr' | 'image' | 'svg' | 'group';

export interface LayerLabel {
  /** The stored element name, unchanged. */
  name: string;
  /** What the element shows or is, so rows read like the label instead of a list of types. */
  meta?: string;
}

const MAX_META = 24;
const excerpt = (value: string): string => {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > MAX_META ? `${single.slice(0, MAX_META - 1)}…` : single;
};
const mm = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** Row text for the layer list: the element's name plus a short description derived from its content. */
export function layerLabel(element: LabelElement, document: LabelDocument): LayerLabel {
  const name = element.name;
  const withMeta = (meta: string | undefined): LayerLabel => (meta && meta !== name ? { name, meta } : { name });
  switch (element.type) {
    case 'text':
      return withMeta(excerpt(element.text));
    case 'barcode':
    case 'qr':
      return withMeta(excerpt(element.value));
    case 'image':
    case 'svg':
      return withMeta(document.resources.find((item) => item.id === element.resourceId)?.name);
    case 'group':
      return withMeta(`${element.childIds.length} ${element.childIds.length === 1 ? 'item' : 'items'}`);
    default:
      return withMeta(`${mm(element.transform.width)} × ${mm(element.transform.height)} mm`);
  }
}

export function layerIcon(element: LabelElement): LayerIcon {
  return element.type;
}
