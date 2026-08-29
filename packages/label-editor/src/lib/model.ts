// SPDX-License-Identifier: AGPL-3.0-or-later
export type Id = string;
export type Millimetres = number;
export type Orientation = 'portrait' | 'landscape';
export type LabelShape = 'rectangle' | 'round' | 'continuous';
export type OverflowMode = 'no-wrap' | 'word-wrap' | 'clip' | 'shrink-to-fit' | 'auto-height';

export interface Point { x: Millimetres; y: Millimetres }
export interface Size { width: Millimetres; height: Millimetres }
export interface Bounds extends Point, Size {}
export interface Transform extends Bounds { rotation: number }
export interface Zone extends Bounds { id: Id; name: string; cloneOf?: Id }
export interface Media {
  width: Millimetres;
  height: Millimetres;
  unit: 'mm';
  dpi: number;
  orientation: Orientation;
  printableBounds: Bounds;
  shape: LabelShape;
  zones?: Zone[];
}

export interface Resource { id: Id; name: string; mimeType: string; sha256: string; data: string }
export interface FontResource extends Resource { family: string; weight: number; style: 'normal' | 'italic' }
export interface Constraint { kind: 'inside-media' | 'aspect' | 'min-size' | 'zone'; value?: number | string }
export interface ElementBase {
  id: Id;
  name: string;
  transform: Transform;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  groupId?: Id;
  constraints?: Constraint[];
}
export interface TextElement extends ElementBase {
  type: 'text'; text: string; fontFamily: string; fontSize: number; fontWeight: number;
  horizontalAlign: 'left' | 'center' | 'right'; verticalAlign: 'top' | 'middle' | 'bottom'; overflow: OverflowMode;
}
export interface ImageElement extends ElementBase { type: 'image'; resourceId: Id; fit: 'contain' | 'cover' | 'stretch'; crop?: Bounds; dither?: DitherSettings }
export interface SvgElement extends ElementBase { type: 'svg'; resourceId: Id }
export interface ShapeElement extends ElementBase { type: 'line' | 'rectangle' | 'ellipse' | 'triangle'; strokeWidth: number; filled: boolean }
export interface BarcodeElement extends ElementBase { type: 'barcode'; value: string; symbology: 'code128' | 'ean13' | 'upca' | 'code39'; showText: boolean }
export interface QrElement extends ElementBase { type: 'qr'; value: string; errorCorrection: 'L' | 'M' | 'Q' | 'H' }
export interface GroupElement extends ElementBase { type: 'group'; childIds: Id[] }
export type LabelElement = TextElement | ImageElement | SvgElement | ShapeElement | BarcodeElement | QrElement | GroupElement;
export interface DitherSettings { algorithm: 'threshold' | 'bayer' | 'floyd-steinberg'; threshold: number }
export interface TemplateData { fields: string[]; records: Record<string, string>[]; currentRecord: number }
export interface LabelDocument {
  version: 4;
  id: Id;
  title: string;
  media: Media;
  coordinateSystem: { origin: 'top-left'; x: 'right'; y: 'down'; rounding: 'half-away-from-zero'; precision: number };
  elements: LabelElement[];
  resources: Resource[];
  fonts: FontResource[];
  template?: TemplateData;
  extensions?: Record<string, unknown>;
  createdAt: string;
  modifiedAt: string;
}

export const uuid = (): Id => globalThis.crypto?.randomUUID?.() ?? `mb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function defaultDocument(now = new Date().toISOString()): LabelDocument {
  return {
    version: 4, id: uuid(), title: 'Untitled label',
    media: { width: 50, height: 30, unit: 'mm', dpi: 203, orientation: 'landscape', shape: 'rectangle', printableBounds: { x: 0, y: 0, width: 50, height: 30 } },
    coordinateSystem: { origin: 'top-left', x: 'right', y: 'down', rounding: 'half-away-from-zero', precision: 1000 },
    elements: [], resources: [], fonts: [], createdAt: now, modifiedAt: now
  };
}

export const cloneDocument = (doc: LabelDocument): LabelDocument => structuredClone(doc);
export function assertV4Document(value: unknown): asserts value is LabelDocument {
  if (!value || typeof value !== 'object') throw new Error('Document must be an object');
  const doc = value as Partial<LabelDocument>;
  if (doc.version !== 4) throw new Error('Only label document v4 can be opened');
  if (!doc.id || !doc.media || !Array.isArray(doc.elements) || !Array.isArray(doc.resources) || !Array.isArray(doc.fonts)) throw new Error('Invalid v4 document');
  if (doc.media.unit !== 'mm' || doc.media.width! <= 0 || doc.media.height! <= 0 || doc.media.dpi! <= 0) throw new Error('Invalid media');
  const ids = new Set<string>();
  for (const element of doc.elements) {
    if (!element.id || ids.has(element.id)) throw new Error(`Duplicate or missing element id: ${element.id}`);
    ids.add(element.id);
  }
}
