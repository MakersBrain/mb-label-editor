// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuid, type LabelElement } from './model.js';
let clipboard: LabelElement[] = [];
export function copyElements(elements: LabelElement[], ids: Iterable<string>) { const selected = new Set(ids); clipboard = structuredClone(elements.filter((item) => selected.has(item.id))); return clipboard.length; }
export function pasteElements(offset = { x: 1, y: 1 }): LabelElement[] { const ids = new Map(clipboard.map((item) => [item.id, uuid()])); return structuredClone(clipboard).map((item) => { item.id = ids.get(item.id)!; item.name += ' copy'; item.transform.x += offset.x; item.transform.y += offset.y; if (item.groupId && ids.has(item.groupId)) item.groupId = ids.get(item.groupId); if (item.type === 'group') item.childIds = item.childIds.map((id) => ids.get(id) ?? id); return item; }); }
