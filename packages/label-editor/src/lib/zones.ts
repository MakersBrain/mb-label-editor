// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  cloneDocument,
  elementAncestry,
  indexDocument,
  type Bounds,
  type LabelDocument,
  type LabelElement,
  type Point,
  type Zone,
} from './model.js';
import { materializeRecord } from './template/materialize.js';
export const elementZone = (element: LabelElement) =>
  String(element.constraints?.find((item) => item.kind === 'zone')?.value ?? '');
/** Matches the SDK's nearest element-or-ancestor zone lookup. */
export function effectiveElementZone(document: LabelDocument, element: LabelElement): string {
  for (const item of elementAncestry(document, element)) {
    const zone = elementZone(item);
    if (zone) return zone;
  }
  return '';
}
export function elementRootOffset(document: LabelDocument, element: LabelElement): Point {
  const id = effectiveElementZone(document, element);
  const zone = id ? indexDocument(document).zonesById.get(id) : undefined;
  return { x: zone?.x ?? 0, y: zone?.y ?? 0 };
}
export function elementRootBounds(document: LabelDocument, element: LabelElement): Bounds {
  const offset = elementRootOffset(document, element);
  return {
    x: element.transform.x + offset.x,
    y: element.transform.y + offset.y,
    width: element.transform.width,
    height: element.transform.height,
  };
}
export function assignToZone(element: LabelElement, zoneId: string): LabelElement {
  const copy = structuredClone(element);
  copy.constraints = [
    ...(copy.constraints ?? []).filter((item) => item.kind !== 'zone'),
    { kind: 'zone', value: zoneId },
  ];
  return copy;
}
export function expandClonedZones(document: LabelDocument): LabelDocument {
  const copy = cloneDocument(document);
  const zones = copy.media.zones ?? [];
  const additions: LabelElement[] = [];
  for (const zone of zones.filter((item) => item.cloneOf)) {
    const source = zones.find((item) => item.id === zone.cloneOf);
    if (!source) throw new Error(`Clone zone ${zone.id} references missing zone ${zone.cloneOf}`);
    for (const element of copy.elements.filter((item) => elementZone(item) === source.id)) {
      const clone = assignToZone(element, zone.id);
      clone.id = `${element.id}@${zone.id}`;
      clone.name = `${element.name} (${zone.name})`;
      /* Coordinates remain zone-local; remove cloneOf below so the SDK does not expand this placement again. */ additions.push(
        clone,
      );
    }
    delete zone.cloneOf;
  }
  copy.elements.push(...additions);
  return copy;
}
export interface BatchPlacement {
  record: number;
  page: number;
  zone: string;
}
export function layoutBatch(recordCount: number, zones: Zone[]): BatchPlacement[] {
  if (!zones.length) throw new Error('Batch layout requires at least one zone.');
  return Array.from({ length: recordCount }, (_, record) => ({
    record,
    page: Math.floor(record / zones.length),
    zone: zones[record % zones.length].id,
  }));
}
export function materializeZonePages(document: LabelDocument, zones: Zone[]): LabelDocument[] {
  const count = document.template?.records.length ?? 0;
  const placements = layoutBatch(count, zones);
  const pages = new Map<number, LabelDocument>();
  for (const placement of placements) {
    const zone = zones.find((item) => item.id === placement.zone);
    if (!zone) throw new Error(`Unknown batch zone ${placement.zone}`);
    const record = materializeRecord(document, placement.record);
    let page = pages.get(placement.page);
    if (!page) {
      page = cloneDocument(document);
      page.id = `${document.id}:page:${placement.page}`;
      page.title = `${document.title} page ${placement.page + 1}`;
      page.elements = [];
      delete page.template;
      pages.set(placement.page, page);
    }
    for (const element of record.elements) {
      const copy = structuredClone(element);
      copy.id = `${element.id}:record:${placement.record}:zone:${zone.id}`;
      copy.name = `${element.name} (record ${placement.record + 1}, ${zone.name})`;
      copy.zIndex = page.elements.length;
      /* Element coordinates remain zone-local; the authoritative SDK applies the zone origin exactly once. */ copy.constraints =
        [...(copy.constraints ?? []).filter((item) => item.kind !== 'zone'), { kind: 'zone', value: zone.id }];
      page.elements.push(copy);
    }
  }
  return [...pages.values()];
}
/** Union of the root-coordinate bounds of the given elements, or undefined when none match. */
export function selectionBounds(document: LabelDocument, ids: Iterable<string>): Bounds | undefined {
  const wanted = new Set(ids);
  const roots = document.elements
    .filter((item) => wanted.has(item.id))
    .map((item) => elementRootBounds(document, item));
  if (!roots.length) return undefined;
  const x = Math.min(...roots.map((item) => item.x));
  const y = Math.min(...roots.map((item) => item.y));
  const right = Math.max(...roots.map((item) => item.x + item.width));
  const bottom = Math.max(...roots.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}
