// SPDX-License-Identifier: AGPL-3.0-or-later
import { derived, writable, type Readable } from 'svelte/store';
import type { Command } from './commands.js';
import { DocumentHistory, type HistoryState } from './history.js';
import type { Id, LabelDocument, LabelElement, Point } from './model.js';

export interface ViewState { zoom: number; pan: Point; gridSize: number; showGrid: boolean; showRulers: boolean; snapping: boolean; guides: { axis: 'x' | 'y'; value: number }[]; manualGuides: { axis: 'x' | 'y'; value: number }[] }
export interface EditorState extends HistoryState { selection: Set<Id>; view: ViewState; selectedElements: LabelElement[] }
export interface EditorStore {
  subscribe: Readable<EditorState>['subscribe']; selection: Readable<Set<Id>>; view: Readable<ViewState>; selectedElements: Readable<LabelElement[]>;
  execute(command: Command): void; undo(): void; redo(): void; replace(document: LabelDocument): void;
  select(ids: Iterable<Id>, additive?: boolean): void; clearSelection(): void; setView(patch: Partial<ViewState>): void;
}
export function createEditorStore(document: LabelDocument): EditorStore {
  const history = new DocumentHistory(document); const state = writable(history.state); const selection = writable(new Set<Id>());
  const view = writable<ViewState>({ zoom: 1, pan: { x: 0, y: 0 }, gridSize: 1, showGrid: true, showRulers: true, snapping: true, guides: [], manualGuides: [] });
  const selectedElements = derived([state, selection], ([$state, $selection]) => $state.document.elements.filter((item) => $selection.has(item.id)));
  const snapshot = derived([state, selection, view, selectedElements], ([$state, $selection, $view, $selectedElements]) => ({ ...$state, selection: $selection, view: $view, selectedElements: $selectedElements }));
  return {
    subscribe: snapshot.subscribe, selection, view, selectedElements,
    execute(command) { state.set(history.execute(command)); }, undo() { state.set(history.undo()); }, redo() { state.set(history.redo()); },
    replace(next) { state.set(history.replace(next)); selection.set(new Set()); },
    select(ids, additive = false) { selection.update((current) => new Set(additive ? [...current, ...ids] : ids)); }, clearSelection() { selection.set(new Set()); },
    setView(patch) { view.update((current) => ({ ...current, ...patch })); }
  };
}
