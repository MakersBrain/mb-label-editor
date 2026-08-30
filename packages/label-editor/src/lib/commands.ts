// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Id, LabelDocument, LabelElement, Point, Transform } from './model.js';
import { cloneDocument, uuid } from './model.js';

export interface Command { readonly label: string; apply(document: LabelDocument): LabelDocument }
const changed = (document: LabelDocument, mutate: (copy: LabelDocument) => void): LabelDocument => {
  const copy = cloneDocument(document); mutate(copy); copy.modifiedAt = new Date().toISOString(); return copy;
};
const elementById = (doc: LabelDocument, id: Id): LabelElement => {
  const item = doc.elements.find((element) => element.id === id);
  if (!item) throw new Error(`Unknown element ${id}`); return item;
};

export const addElement = (element: LabelElement): Command => ({
  label: `Add ${element.type}`, apply: (doc) => changed(doc, (copy) => { copy.elements.push(structuredClone(element)); })
});
export const removeElements = (ids: Iterable<Id>): Command => {
  const selected = new Set(ids);
  return { label: 'Delete elements', apply: (doc) => changed(doc, (copy) => {
    copy.elements = copy.elements.filter((element) => !selected.has(element.id));
    copy.elements.forEach((element) => { if (element.type === 'group') element.childIds = element.childIds.filter((id) => !selected.has(id)); });
  }) };
};
export const patchElement = (id: Id, patch: Partial<LabelElement>): Command => ({
  label: 'Edit element', apply: (doc) => changed(doc, (copy) => Object.assign(elementById(copy, id), structuredClone(patch)))
});
export const transformElements = (ids: Iterable<Id>, transform: (current: Transform) => Transform): Command => {
  const selected = new Set(ids);
  return { label: 'Transform elements', apply: (doc) => changed(doc, (copy) => copy.elements.forEach((element) => {
    if (selected.has(element.id) && !element.locked) element.transform = transform(structuredClone(element.transform));
  })) };
};
export const moveElements = (ids: Iterable<Id>, delta: Point): Command => {
  const selected = [...new Set(ids)];
  return { label: 'Move elements', apply: (doc) => changed(doc, (copy) => {
    const moving = new Set<Id>();
    const include = (id: Id) => {
      if (moving.has(id)) return;
      const element = elementById(copy, id);
      moving.add(id);
      if (element.type === 'group') element.childIds.forEach(include);
    };
    selected.forEach(include);
    copy.elements.forEach((element) => {
      if (moving.has(element.id) && !element.locked) {
        element.transform.x += delta.x;
        element.transform.y += delta.y;
      }
    });
  }) };
};
export const resizeElement = (id: Id, size: { width: number; height: number }, origin?: Point): Command => transformElements([id], (current) => ({ ...current, ...(origin ?? {}), width: Math.max(0.1, size.width), height: Math.max(0.1, size.height) }));
export const rotateElements = (ids: Iterable<Id>, degrees: number): Command => transformElements(ids, (current) => ({ ...current, rotation: ((degrees % 360) + 360) % 360 }));
export const duplicateElements = (ids: Iterable<Id>, offset: Point = { x: 1, y: 1 }): Command => {
  const selected = new Set(ids); return { label: 'Duplicate elements', apply: (doc) => changed(doc, (copy) => {
    const source = copy.elements.filter((item) => selected.has(item.id)); const replacements = new Map(source.map((item) => [item.id, uuid()]));
    for (const item of source) { const duplicate = structuredClone(item); duplicate.id = replacements.get(item.id)!; duplicate.name = `${item.name} copy`; duplicate.transform.x += offset.x; duplicate.transform.y += offset.y; duplicate.zIndex = copy.elements.length;
      if (duplicate.groupId && replacements.has(duplicate.groupId)) duplicate.groupId = replacements.get(duplicate.groupId); if (duplicate.type === 'group') duplicate.childIds = duplicate.childIds.map((id) => replacements.get(id) ?? id); copy.elements.push(duplicate); }
  }) };
};
export const setVisibility = (ids: Iterable<Id>, visible: boolean): Command => bulkPatch(ids, { visible });
export const setLocked = (ids: Iterable<Id>, locked: boolean): Command => bulkPatch(ids, { locked });
export const bulkPatch = (ids: Iterable<Id>, patch: Partial<LabelElement>): Command => {
  const selected = new Set(ids); return { label: 'Edit elements', apply: (doc) => changed(doc, (copy) => copy.elements.forEach((item) => {
    if (selected.has(item.id)) Object.assign(item, structuredClone(patch));
  })) };
};
export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export const alignElements = (ids: Iterable<Id>, alignment: Alignment): Command => {
  const selected = new Set(ids); return { label: `Align ${alignment}`, apply: (doc) => changed(doc, (copy) => {
    const items = copy.elements.filter((item) => selected.has(item.id) && !item.locked); if (items.length < 2) return;
    const left = Math.min(...items.map((item) => item.transform.x)); const right = Math.max(...items.map((item) => item.transform.x + item.transform.width));
    const top = Math.min(...items.map((item) => item.transform.y)); const bottom = Math.max(...items.map((item) => item.transform.y + item.transform.height));
    items.forEach((item) => { const t = item.transform;
      if (alignment === 'left') t.x = left; if (alignment === 'right') t.x = right - t.width; if (alignment === 'center-x') t.x = (left + right - t.width) / 2;
      if (alignment === 'top') t.y = top; if (alignment === 'bottom') t.y = bottom - t.height; if (alignment === 'center-y') t.y = (top + bottom - t.height) / 2;
    });
  }) };
};
export const distributeElements = (ids: Iterable<Id>, axis: 'horizontal' | 'vertical'): Command => {
  const selected = new Set(ids); return { label: `Distribute ${axis}`, apply: (doc) => changed(doc, (copy) => {
    const items = copy.elements.filter((item) => selected.has(item.id) && !item.locked).sort((a, b) => axis === 'horizontal' ? a.transform.x - b.transform.x : a.transform.y - b.transform.y);
    if (items.length < 3) return;
    const position = (item: LabelElement) => axis === 'horizontal' ? item.transform.x : item.transform.y;
    const extent = (item: LabelElement) => axis === 'horizontal' ? item.transform.width : item.transform.height;
    const space = (position(items.at(-1)!) + extent(items.at(-1)!) - position(items[0]) - items.reduce((sum, item) => sum + extent(item), 0)) / (items.length - 1);
    let cursor = position(items[0]) + extent(items[0]) + space;
    for (const item of items.slice(1, -1)) { if (axis === 'horizontal') item.transform.x = cursor; else item.transform.y = cursor; cursor += extent(item) + space; }
  }) };
};
export const reorderElement = (id: Id, target: 'front' | 'back' | 'forward' | 'backward'): Command => ({
  label: `Move ${target}`, apply: (doc) => changed(doc, (copy) => {
    const item = elementById(copy, id); const ordered = [...copy.elements].sort((a, b) => a.zIndex - b.zIndex); const current = ordered.indexOf(item);
    let next = target === 'front' ? ordered.length - 1 : target === 'back' ? 0 : target === 'forward' ? Math.min(current + 1, ordered.length - 1) : Math.max(current - 1, 0);
    ordered.splice(current, 1); ordered.splice(next, 0, item); ordered.forEach((element, index) => { element.zIndex = index; });
  })
});
export const groupElements = (ids: Iterable<Id>): Command => {
  const selected = [...new Set(ids)]; return { label: 'Group elements', apply: (doc) => changed(doc, (copy) => {
    if (selected.length < 2) return; const children = selected.map((id) => elementById(copy, id));
    const x = Math.min(...children.map((item) => item.transform.x)); const y = Math.min(...children.map((item) => item.transform.y));
    const right = Math.max(...children.map((item) => item.transform.x + item.transform.width)); const bottom = Math.max(...children.map((item) => item.transform.y + item.transform.height));
    const id = uuid(); children.forEach((item) => { item.groupId = id; });
    copy.elements.push({ id, type: 'group', name: 'Group', childIds: selected, transform: { x, y, width: right - x, height: bottom - y, rotation: 0 }, zIndex: Math.max(...children.map((item) => item.zIndex)) + 1, visible: true, locked: false });
  }) };
};
export const ungroup = (groupId: Id): Command => ({ label: 'Ungroup elements', apply: (doc) => changed(doc, (copy) => {
  const group = elementById(copy, groupId); if (group.type !== 'group') return;
  copy.elements.forEach((item) => { if (item.groupId === groupId) delete item.groupId; }); copy.elements = copy.elements.filter((item) => item.id !== groupId);
}) });
export const updateDocument = (patch: Partial<Omit<LabelDocument, 'version' | 'elements' | 'resources' | 'fonts'>>): Command => ({ label: 'Edit document', apply: (doc) => changed(doc, (copy) => Object.assign(copy, structuredClone(patch))) });
export const addResource = (resource: LabelDocument['resources'][number]): Command => ({label:'Import asset',apply:(doc)=>changed(doc,copy=>{if(!copy.resources.some(item=>item.sha256===resource.sha256))copy.resources.push(structuredClone(resource))})});
export const addFont = (font: LabelDocument['fonts'][number]): Command => ({label:'Import font',apply:(doc)=>changed(doc,copy=>{if(!copy.fonts.some(item=>item.sha256===font.sha256))copy.fonts.push(structuredClone(font))})});
