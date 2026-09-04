// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Bounds, ElementBase, Id, LabelDocument, LabelElement, Point, Transform } from './model.js';
import { cloneDocument, isEffectivelyLocked, uuid } from './model.js';
import { elementRootBounds, elementRootOffset } from './zones.js';

export interface Command {
  readonly label: string;
  /** Consecutive commands with the same key form one user-visible undo step. */
  readonly coalesceKey?: string;
  apply(document: LabelDocument): LabelDocument;
}
export interface CreatedElementCommand extends Command {
  /** Stable identity allocated when the command is created, for post-command selection. */
  readonly createdId: Id;
}
const changed = (document: LabelDocument, mutate: (copy: LabelDocument) => void): LabelDocument => {
  const copy = cloneDocument(document); mutate(copy); fitGroupsToChildren(copy); copy.modifiedAt = new Date().toISOString(); return copy;
};
/** Group bounds are derived state: refit every group to its children after each command, innermost groups first. */
function fitGroupsToChildren(document: LabelDocument): void {
  const depth = (element: LabelElement): number => { let level = 0; let current = element; while (current.groupId) { const parent = document.elements.find((item) => item.id === current.groupId); if (!parent) break; level++; current = parent; } return level; };
  const groups = document.elements.filter((element) => element.type === 'group').map((group) => ({ group, depth: depth(group) })).sort((a, b) => b.depth - a.depth);
  for (const { group } of groups) {
    const children = group.childIds.flatMap((id) => document.elements.filter((item) => item.id === id));
    if (!children.length) { group.transform = { ...group.transform, width: 0, height: 0 }; continue; }
    const bounds = children.map((item) => elementRootBounds(document, item));
    const x = Math.min(...bounds.map((item) => item.x)); const y = Math.min(...bounds.map((item) => item.y));
    const right = Math.max(...bounds.map((item) => item.x + item.width)); const bottom = Math.max(...bounds.map((item) => item.y + item.height));
    const offset = elementRootOffset(document, group);
    group.transform = { ...group.transform, x: x - offset.x, y: y - offset.y, width: right - x, height: bottom - y };
  }
}
const elementById = (doc: LabelDocument, id: Id): LabelElement => {
  const item = doc.elements.find((element) => element.id === id);
  if (!item) throw new Error(`Unknown element ${id}`); return item;
};

/** Checks the bidirectional group links relied on by editor commands. */
export function assertGroupInvariants(document: LabelDocument): void {
  const elements = new Map(document.elements.map((element) => [element.id, element]));
  const groups = new Map(document.elements.filter((element) => element.type === 'group').map((group) => [group.id, group]));
  for (const element of document.elements) {
    if (!element.groupId) continue;
    const parent = groups.get(element.groupId);
    if (!parent) throw new Error(`Element ${element.id} references missing group ${element.groupId}`);
    if (!parent.childIds.includes(element.id)) throw new Error(`Group ${parent.id} does not contain child ${element.id}`);
  }
  for (const group of groups.values()) {
    const children = new Set<Id>();
    for (const childId of group.childIds) {
      if (childId === group.id) throw new Error(`Group ${group.id} cannot contain itself`);
      if (children.has(childId)) throw new Error(`Group ${group.id} contains duplicate child ${childId}`);
      children.add(childId);
      const child = elements.get(childId);
      if (!child) throw new Error(`Group ${group.id} references missing child ${childId}`);
      if (child.groupId !== group.id) throw new Error(`Child ${childId} does not reference group ${group.id}`);
    }
  }
  const visiting = new Set<Id>();
  const visited = new Set<Id>();
  const visit = (group: Extract<LabelElement, { type: 'group' }>) => {
    if (visiting.has(group.id)) throw new Error(`Group cycle includes ${group.id}`);
    if (visited.has(group.id)) return;
    visiting.add(group.id);
    for (const childId of group.childIds) {
      const child = groups.get(childId);
      if (child) visit(child);
    }
    visiting.delete(group.id);
    visited.add(group.id);
  };
  for (const group of groups.values()) visit(group);
}

export const addElement = (element: LabelElement): Command => ({
  label: `Add ${element.type}`, apply: (doc) => changed(doc, (copy) => { copy.elements.push(structuredClone(element)); })
});
export const removeElements = (ids: Iterable<Id>): Command => {
  const selected = new Set(ids);
  return { label: 'Delete elements', apply: (doc) => changed(doc, (copy) => {
    copy.elements = copy.elements.filter((element) => !selected.has(element.id));
    copy.elements.forEach((element) => {
      if (element.groupId && selected.has(element.groupId)) delete element.groupId;
      if (element.type === 'group') element.childIds = element.childIds.filter((id) => !selected.has(id));
    });
    assertGroupInvariants(copy);
  }) };
};
export const patchElement = (id: Id, patch: Partial<LabelElement>): Command => ({
  label: 'Edit element', coalesceKey: `edit:${id}:${Object.keys(patch).sort().join(',')}`, apply: (doc) => changed(doc, (copy) => {
    if (['id', 'type', 'groupId', 'childIds'].some((key) => Object.hasOwn(patch, key))) throw new Error('Element identity and group links require a dedicated command');
    Object.assign(elementById(copy, id), structuredClone(patch));
  })
});
export const transformElements = (ids: Iterable<Id>, transform: (current: Transform) => Transform, operation = 'transform'): Command => {
  const selected = new Set(ids); const coalesceKey = `${operation}:${[...selected].sort().join(',')}`;
  return { label: 'Transform elements', coalesceKey, apply: (doc) => changed(doc, (copy) => copy.elements.forEach((element) => {
    if (selected.has(element.id) && !isEffectivelyLocked(copy, element)) element.transform = transform(structuredClone(element.transform));
  })) };
};
export const moveElements = (ids: Iterable<Id>, delta: Point): Command => {
  const selected = [...new Set(ids)]; const coalesceKey = `move:${[...selected].sort().join(',')}`;
  return { label: 'Move elements', coalesceKey, apply: (doc) => changed(doc, (copy) => {
    const moving = new Set<Id>();
    const include = (id: Id) => {
      if (moving.has(id)) return;
      const element = elementById(copy, id);
      moving.add(id);
      if (element.type === 'group') element.childIds.forEach(include);
    };
    selected.forEach(include);
    copy.elements.forEach((element) => {
      if (moving.has(element.id) && !isEffectivelyLocked(copy, element)) {
        element.transform.x += delta.x;
        element.transform.y += delta.y;
      }
    });
  }) };
};
export const resizeElement = (id: Id, size: { width: number; height: number }, origin?: Point): Command => transformElements([id], (current) => ({ ...current, ...(origin ?? {}), width: Math.max(0.1, size.width), height: Math.max(0.1, size.height) }), 'resize');
export const resizeElements = (ids: Iterable<Id>, bounds: Bounds): Command => {
  const selected = [...new Set(ids)];
  return { label: 'Resize elements', coalesceKey: `resize:${[...selected].sort().join(',')}`, apply: (doc) => changed(doc, (copy) => {
    const roots = topLevelSelection(copy, selected);
    const items = roots.map((id) => elementById(copy, id)).filter((item) => !isEffectivelyLocked(copy, item));
    if (!items.length) return;
    const source = elementBounds(items.map((item)=>({...item,transform:{...item.transform,...elementRootBounds(copy,item)}})));
    const scaleX = bounds.width / Math.max(0.1, source.width);
    const scaleY = bounds.height / Math.max(0.1, source.height);
    const resizing = descendantIds(copy, items.map((item) => item.id));
    copy.elements.forEach((element) => {
      if (!resizing.has(element.id) || isEffectivelyLocked(copy, element)) return;
      const transform = element.transform;
      const offset=elementRootOffset(copy,element);
      transform.x = bounds.x + (transform.x+offset.x-source.x) * scaleX-offset.x;
      transform.y = bounds.y + (transform.y+offset.y-source.y) * scaleY-offset.y;
      transform.width = Math.max(0.1, transform.width * scaleX);
      transform.height = Math.max(0.1, transform.height * scaleY);
    });
  }) };
};
export const rotateElements = (ids: Iterable<Id>, degrees: number): Command => transformElements(ids, (current) => ({ ...current, rotation: ((degrees % 360) + 360) % 360 }), 'rotate');
export const duplicateElements = (ids: Iterable<Id>, offset: Point = { x: 1, y: 1 }): Command => {
  const selected = new Set(ids); return { label: 'Duplicate elements', apply: (doc) => changed(doc, (copy) => {
    const include = (id: Id) => {
      if (selected.has(id)) return;
      selected.add(id);
      const element = elementById(copy, id);
      if (element.type === 'group') element.childIds.forEach(include);
    };
    [...selected].forEach((id) => {
      const element = elementById(copy, id);
      if (element.type === 'group') element.childIds.forEach(include);
    });
    const source = copy.elements.filter((item) => selected.has(item.id)); const replacements = new Map(source.map((item) => [item.id, uuid()]));
    const firstZIndex = copy.elements.length;
    for (const [index, item] of source.entries()) { const duplicate = structuredClone(item); duplicate.id = replacements.get(item.id)!; duplicate.name = `${item.name} copy`; duplicate.transform.x += offset.x; duplicate.transform.y += offset.y; duplicate.zIndex = firstZIndex + index;
      if (duplicate.groupId && replacements.has(duplicate.groupId)) duplicate.groupId = replacements.get(duplicate.groupId); else delete duplicate.groupId;
      if (duplicate.type === 'group') duplicate.childIds = duplicate.childIds.map((id) => replacements.get(id)!);
      copy.elements.push(duplicate); }
    assertGroupInvariants(copy);
  }) };
};
export const setVisibility = (ids: Iterable<Id>, visible: boolean): Command => bulkPatch(ids, { visible });
export const setLocked = (ids: Iterable<Id>, locked: boolean): Command => bulkPatch(ids, { locked });
export const bulkPatch = (ids: Iterable<Id>, patch: Partial<Pick<ElementBase, 'visible' | 'locked'>>): Command => {
  const selected = new Set(ids); return { label: 'Edit elements', apply: (doc) => changed(doc, (copy) => copy.elements.forEach((item) => {
    if (selected.has(item.id)) Object.assign(item, structuredClone(patch));
  })) };
};
export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export const alignElements = (ids: Iterable<Id>, alignment: Alignment): Command => {
  const selected = new Set(ids); return { label: `Align ${alignment}`, apply: (doc) => changed(doc, (copy) => {
    const items = copy.elements.filter((item) => selected.has(item.id) && !isEffectivelyLocked(copy, item)); if (items.length < 2) return;
    const left = Math.min(...items.map((item) => item.transform.x)); const right = Math.max(...items.map((item) => item.transform.x + item.transform.width));
    const top = Math.min(...items.map((item) => item.transform.y)); const bottom = Math.max(...items.map((item) => item.transform.y + item.transform.height));
    items.forEach((item) => { const t = item.transform;
      if (alignment === 'left') t.x = left; if (alignment === 'right') t.x = right - t.width; if (alignment === 'center-x') t.x = (left + right - t.width) / 2;
      if (alignment === 'top') t.y = top; if (alignment === 'bottom') t.y = bottom - t.height; if (alignment === 'center-y') t.y = (top + bottom - t.height) / 2;
    });
  }) };
};
/** Aligns each selected top-level element (or group subtree) inside an explicit label/zone boundary. */
export const alignElementsToBounds = (ids: Iterable<Id>, alignment: Alignment, bounds: Bounds): Command => {
  const selected = [...new Set(ids)];
  return { label: `Align ${alignment} to boundary`, apply: (doc) => changed(doc, (copy) => {
    for (const id of topLevelSelection(copy, selected)) {
      const item = elementById(copy, id);
      if (isEffectivelyLocked(copy, item)) continue;
      const root=elementRootBounds(copy,item);
      const delta = { x: 0, y: 0 };
      if (alignment === 'left') delta.x = bounds.x - root.x;
      if (alignment === 'right') delta.x = bounds.x + bounds.width - root.x - root.width;
      if (alignment === 'center-x') delta.x = bounds.x + (bounds.width - root.width) / 2 - root.x;
      if (alignment === 'top') delta.y = bounds.y - root.y;
      if (alignment === 'bottom') delta.y = bounds.y + bounds.height - root.y - root.height;
      if (alignment === 'center-y') delta.y = bounds.y + (bounds.height - root.height) / 2 - root.y;
      const moving = descendantIds(copy, [id]);
      copy.elements.forEach((element) => {
        if (!moving.has(element.id) || isEffectivelyLocked(copy, element)) return;
        element.transform.x += delta.x;
        element.transform.y += delta.y;
      });
    }
  }) };
};
export const distributeElements = (ids: Iterable<Id>, axis: 'horizontal' | 'vertical'): Command => {
  const selected = new Set(ids); return { label: `Distribute ${axis}`, apply: (doc) => changed(doc, (copy) => {
    const items = copy.elements.filter((item) => selected.has(item.id) && !isEffectivelyLocked(copy, item)).sort((a, b) => axis === 'horizontal' ? a.transform.x - b.transform.x : a.transform.y - b.transform.y);
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
export const groupElements = (ids: Iterable<Id>): CreatedElementCommand => {
  const selected = [...new Set(ids)]; const createdId = uuid(); return { label: 'Group elements', createdId, apply: (doc) => changed(doc, (copy) => {
    if (selected.length < 2) return; const children = selected.map((id) => elementById(copy, id));
    if (children.some((item) => item.groupId)) throw new Error('Ungroup nested elements before grouping them again');
    const bounds = children.map((item) => elementRootBounds(copy, item));
    const x = Math.min(...bounds.map((item) => item.x)); const y = Math.min(...bounds.map((item) => item.y));
    const right = Math.max(...bounds.map((item) => item.x + item.width)); const bottom = Math.max(...bounds.map((item) => item.y + item.height));
    children.forEach((item) => { item.groupId = createdId; });
    copy.elements.push({ id: createdId, type: 'group', name: 'Group', childIds: selected, transform: { x, y, width: right - x, height: bottom - y, rotation: 0 }, zIndex: Math.max(...children.map((item) => item.zIndex)) + 1, visible: true, locked: false });
    assertGroupInvariants(copy);
  }) };
};
const isInside = (document: LabelDocument, id: Id, ancestorId: Id): boolean => { let current = elementById(document, id); while (current.groupId) { if (current.groupId === ancestorId) return true; current = elementById(document, current.groupId); } return false; };
/** Adds an empty group so elements can be dropped into it from the layer list. */
export const createGroup = (name = 'Group'): CreatedElementCommand => {
  const createdId = uuid(); return { label: 'Add group', createdId, apply: (doc) => changed(doc, (copy) => {
    const zIndex = copy.elements.length ? Math.max(...copy.elements.map((item) => item.zIndex)) + 1 : 0;
    copy.elements.push({ id: createdId, type: 'group', name, childIds: [], transform: { x: 0, y: 0, width: 0, height: 0, rotation: 0 }, zIndex, visible: true, locked: false });
    assertGroupInvariants(copy);
  }) };
};
/** Moves elements into a group, or to the root when `groupId` is undefined, keeping their placement on the label. */
export const moveToGroup = (ids: Iterable<Id>, groupId: Id | undefined): Command => {
  const moved = [...new Set(ids)]; return { label: groupId ? 'Move into group' : 'Move out of group', apply: (doc) => changed(doc, (copy) => {
    const target = groupId ? elementById(copy, groupId) : undefined;
    if (target && target.type !== 'group') throw new Error(`Target ${target.id} is not a group`);
    for (const id of moved) {
      const item = elementById(copy, id);
      if (target && (id === target.id || isInside(copy, target.id, id))) throw new Error('A group cannot be moved into itself');
      if (item.groupId === groupId) continue;
      if (item.groupId) { const parent = elementById(copy, item.groupId); if (parent.type === 'group') parent.childIds = parent.childIds.filter((child) => child !== id); }
      if (target?.type === 'group') { target.childIds.push(id); item.groupId = target.id; } else delete item.groupId;
    }
    assertGroupInvariants(copy);
  }) };
};
export const ungroup = (groupId: Id): Command => ({ label: 'Ungroup elements', apply: (doc) => changed(doc, (copy) => {
  const group = elementById(copy, groupId); if (group.type !== 'group') return;
  const parent = group.groupId ? elementById(copy, group.groupId) : undefined;
  if (parent && parent.type !== 'group') throw new Error(`Parent ${parent.id} is not a group`);
  copy.elements.forEach((item) => { if (item.groupId === groupId) { if (parent) item.groupId = parent.id; else delete item.groupId; } });
  if (parent) parent.childIds = parent.childIds.flatMap((id) => id === groupId ? group.childIds : [id]);
  copy.elements = copy.elements.filter((item) => item.id !== groupId);
  assertGroupInvariants(copy);
}) });
export const updateDocument = (patch: Partial<Omit<LabelDocument, 'version' | 'elements' | 'resources' | 'fonts'>>): Command => ({ label: 'Edit document', apply: (doc) => changed(doc, (copy) => Object.assign(copy, structuredClone(patch))) });

function topLevelSelection(document: LabelDocument, ids: Iterable<Id>): Id[] {
  const selected = new Set(ids);
  return [...selected].filter((id) => {
    let item = elementById(document, id);
    while (item.groupId) {
      if (selected.has(item.groupId)) return false;
      item = elementById(document, item.groupId);
    }
    return true;
  });
}

function descendantIds(document: LabelDocument, ids: Iterable<Id>): Set<Id> {
  const result = new Set<Id>();
  const include = (id: Id) => {
    if (result.has(id)) return;
    const item = elementById(document, id);
    result.add(id);
    if (item.type === 'group') item.childIds.forEach(include);
  };
  for (const id of ids) include(id);
  return result;
}

function elementBounds(items: LabelElement[]): Bounds {
  const x = Math.min(...items.map((item) => item.transform.x));
  const y = Math.min(...items.map((item) => item.transform.y));
  const right = Math.max(...items.map((item) => item.transform.x + item.transform.width));
  const bottom = Math.max(...items.map((item) => item.transform.y + item.transform.height));
  return { x, y, width: right - x, height: bottom - y };
}
// Resource references are ID-based. Two imports may intentionally share bytes
// while using different IDs, so content-hash deduplication would leave a newly
// placed element pointing at a resource that was never inserted.
export const addResource = (resource: LabelDocument['resources'][number]): Command => ({label:'Import asset',apply:(doc)=>changed(doc,copy=>{if(!copy.resources.some(item=>item.id===resource.id))copy.resources.push(structuredClone(resource))})});
export const addFont = (font: LabelDocument['fonts'][number]): Command => ({label:'Import font',apply:(doc)=>changed(doc,copy=>{if(!copy.fonts.some(item=>item.sha256===font.sha256))copy.fonts.push(structuredClone(font))})});
