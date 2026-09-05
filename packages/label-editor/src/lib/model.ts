// SPDX-License-Identifier: AGPL-3.0-or-later
export type Id = string;
export type Millimetres = number;
export type Orientation = 'portrait' | 'landscape';
export type LabelShape = 'rectangle' | 'round' | 'continuous';
export type OverflowMode = 'no-wrap' | 'word-wrap' | 'clip' | 'shrink-to-fit' | 'auto-height';

export interface Point {
  x: Millimetres;
  y: Millimetres;
}
export interface Size {
  width: Millimetres;
  height: Millimetres;
}
export interface Bounds extends Point, Size {}
export interface Transform extends Bounds {
  rotation: number;
}
export interface Zone extends Bounds {
  id: Id;
  name: string;
  cloneOf?: Id;
}
export interface ContinuousMediaSettingsV1 {
  version: 1;
  lengthMode: 'fixed' | 'fit-content';
  fixedLengthMm: Millimetres;
  leadingMarginMm: Millimetres;
  trailingMarginMm: Millimetres;
  preferredMinimumLengthMm?: Millimetres;
  preferredMaximumLengthMm?: Millimetres;
  batchLengthMode: 'per-record' | 'uniform-longest';
}
export interface Media {
  width: Millimetres;
  height: Millimetres;
  unit: 'mm';
  dpi: number;
  orientation: Orientation;
  printableBounds: Bounds;
  shape: LabelShape;
  zones?: Zone[];
  continuousSettings?: ContinuousMediaSettingsV1;
}

export interface Resource {
  id: Id;
  name: string;
  mimeType: string;
  sha256: string;
  data: string;
}
export interface FontResource extends Resource {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
}
export interface Constraint {
  kind: 'inside-media' | 'aspect' | 'min-size' | 'zone';
  value?: number | string;
}
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
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Canonical embedded-font resource retained even when the editor cannot identify its family. */
  fontResourceId?: Id;
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  overflow: OverflowMode;
}
export interface ImageElement extends ElementBase {
  type: 'image';
  resourceId: Id;
  fit: 'contain' | 'cover' | 'stretch';
  crop?: Bounds;
  dither?: DitherSettings;
  invert?: boolean;
}
export interface SvgElement extends ElementBase {
  type: 'svg';
  resourceId: Id;
}
export interface ShapeElement extends ElementBase {
  type: 'line' | 'rectangle' | 'ellipse' | 'triangle';
  strokeWidth: number;
  filled: boolean;
}
export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  value: string;
  symbology: 'code128' | 'ean13' | 'upca' | 'code39';
  showText: boolean;
}
export interface QrElement extends ElementBase {
  type: 'qr';
  value: string;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  /** Blank modules around the symbol; the standard asks for 4. Absent means 4. */
  quietZone?: number;
}
export const DEFAULT_QR_QUIET_ZONE = 4;
export interface GroupElement extends ElementBase {
  type: 'group';
  childIds: Id[];
}
export type LabelElement =
  TextElement | ImageElement | SvgElement | ShapeElement | BarcodeElement | QrElement | GroupElement;
export interface DitherSettings {
  algorithm: 'auto' | 'threshold' | 'bayer' | 'floyd-steinberg' | 'atkinson';
  threshold: number;
}
/** A column computed from the others with a template expression, in declaration order. */
export interface DerivedField {
  name: string;
  expression: string;
}
export interface TemplateData {
  fields: string[];
  fieldLabels?: Record<string, string>;
  records: Record<string, string>[];
  currentRecord: number;
  /** Computed columns; they are resolved into every record before elements, previews and prints read it. */
  derived?: DerivedField[];
}
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

export const uuid = (): Id =>
  globalThis.crypto?.randomUUID?.() ?? `mb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function defaultDocument(now = new Date().toISOString()): LabelDocument {
  return {
    version: 4,
    id: uuid(),
    title: 'Untitled label',
    media: {
      width: 50,
      height: 30,
      unit: 'mm',
      dpi: 203,
      orientation: 'landscape',
      shape: 'rectangle',
      printableBounds: { x: 0, y: 0, width: 50, height: 30 },
    },
    coordinateSystem: { origin: 'top-left', x: 'right', y: 'down', rounding: 'half-away-from-zero', precision: 1000 },
    elements: [],
    resources: [],
    fonts: [],
    createdAt: now,
    modifiedAt: now,
  };
}

export const cloneDocument = (doc: LabelDocument): LabelDocument => structuredClone(doc);
/** Structural equality with an identity fast path; `modifiedAt` is ignored because commands stamp it. */
export function documentsEqual(a: LabelDocument, b: LabelDocument): boolean {
  if (a === b) return true;
  for (const key of Object.keys({ ...a, ...b }) as (keyof LabelDocument)[]) {
    if (key === 'modifiedAt') continue;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a))
    return a.length === (b as unknown[]).length && a.every((item, index) => deepEqual(item, (b as unknown[])[index]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  if (keys.length !== Object.keys(right).filter((key) => right[key] !== undefined).length) return false;
  return keys.every((key) => deepEqual(left[key], right[key]));
}
const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
/** In development, freezes a document so accidental mutation of history state throws instead of corrupting undo. */
export function freezeDocument(doc: LabelDocument): LabelDocument {
  if (!isDev) return doc;
  const freeze = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  };
  freeze(doc);
  return doc;
}
export function assertV4Document(value: unknown): asserts value is LabelDocument {
  if (!value || typeof value !== 'object') throw new Error('Document must be an object');
  const doc = value as Partial<LabelDocument>;
  if (doc.version !== 4) throw new Error('Only label document v4 can be opened');
  if (
    !doc.id ||
    !doc.media ||
    !Array.isArray(doc.elements) ||
    !Array.isArray(doc.resources) ||
    !Array.isArray(doc.fonts)
  )
    throw new Error('Invalid v4 document');
  if (doc.media.unit !== 'mm' || doc.media.width! <= 0 || doc.media.height! <= 0 || doc.media.dpi! <= 0)
    throw new Error('Invalid media');
  const ids = new Set<string>();
  for (const element of doc.elements) {
    if (!element.id || ids.has(element.id)) throw new Error(`Duplicate or missing element id: ${element.id}`);
    ids.add(element.id);
  }
}

/**
 * Per-document lookup tables. Built lazily and cached by document identity, so
 * the ancestry, lock, visibility and zone helpers are O(depth) instead of
 * scanning the element list. The cache is dropped when the element array is
 * replaced or grows; commands also invalidate it explicitly after mutating.
 */
export interface DocumentIndex {
  byId: Map<Id, LabelElement>;
  zonesById: Map<string, Zone>;
  /** Enclosing groups of an element, nearest first; excludes the element itself. */
  parents: Map<Id, LabelElement[]>;
  locked: Map<Id, boolean>;
  visible: Map<Id, boolean>;
}
const indexes = new WeakMap<LabelDocument, { elements: LabelElement[]; length: number; index: DocumentIndex }>();
export function indexDocument(document: LabelDocument): DocumentIndex {
  const cached = indexes.get(document);
  if (cached && cached.elements === document.elements && cached.length === document.elements.length)
    return cached.index;
  const index: DocumentIndex = {
    byId: new Map(document.elements.map((item) => [item.id, item])),
    zonesById: new Map((document.media.zones ?? []).map((zone) => [zone.id, zone])),
    parents: new Map(),
    locked: new Map(),
    visible: new Map(),
  };
  indexes.set(document, { elements: document.elements, length: document.elements.length, index });
  return index;
}
export function invalidateDocumentIndex(document: LabelDocument): void {
  indexes.delete(document);
}
function parentsOf(index: DocumentIndex, element: LabelElement): LabelElement[] {
  let chain = index.parents.get(element.id);
  if (!chain) {
    chain = [];
    const seen = new Set<Id>([element.id]);
    let current = element.groupId ? index.byId.get(element.groupId) : undefined;
    while (current && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = current.groupId ? index.byId.get(current.groupId) : undefined;
    }
    index.parents.set(element.id, chain);
  }
  return chain;
}
/** Walks an element and its enclosing groups; the element comes first. */
export function elementAncestry(document: LabelDocument, element: LabelElement): LabelElement[] {
  return [element, ...parentsOf(indexDocument(document), element)];
}
/** Locking a group locks everything inside it. */
export function isEffectivelyLocked(document: LabelDocument, element: LabelElement): boolean {
  const index = indexDocument(document);
  let value = index.locked.get(element.id);
  if (value === undefined) {
    value = element.locked || parentsOf(index, element).some((item) => item.locked);
    index.locked.set(element.id, value);
  }
  return value;
}
/** Hiding a group hides everything inside it. */
export function isEffectivelyVisible(document: LabelDocument, element: LabelElement): boolean {
  const index = indexDocument(document);
  let value = index.visible.get(element.id);
  if (value === undefined) {
    value = element.visible && parentsOf(index, element).every((item) => item.visible);
    index.visible.set(element.id, value);
  }
  return value;
}
