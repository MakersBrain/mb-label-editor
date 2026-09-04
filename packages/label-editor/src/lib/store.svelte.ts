// SPDX-License-Identifier: AGPL-3.0-or-later
import { SvelteSet } from 'svelte/reactivity';
import type { Command } from './commands.js';
import { DocumentHistory, type HistoryState } from './history.js';
import type { Id, LabelDocument, LabelElement, Point } from './model.js';
import { clampZoom, type ViewportSize } from './view.js';
import type { InsertType } from './insert.js';

export interface ViewState {
  zoom: number;
  pan: Point;
  gridSize: number;
  showGrid: boolean;
  showRulers: boolean;
  snapping: boolean;
  guides: { axis: 'x' | 'y'; value: number }[];
  manualGuides: { axis: 'x' | 'y'; value: number }[];
  /** Size of the canvas viewport in CSS pixels, reported by the canvas. */
  viewport: ViewportSize;
  /** `fit` keeps the whole label in view until the user zooms or pans by hand. */
  zoomMode: 'fit' | 'manual';
}

const defaultView = (): ViewState => ({
  zoom: 1,
  pan: { x: 0, y: 0 },
  gridSize: 1,
  showGrid: true,
  showRulers: true,
  snapping: true,
  guides: [],
  manualGuides: [],
  viewport: { width: 0, height: 0 },
  zoomMode: 'fit',
});

/**
 * Editor state as fine-grained runes. Reading `editor.view.zoom` inside a
 * component tracks only `zoom`; reading `editor.document` tracks only the
 * document, which commands replace wholesale and never mutate, so it is held
 * as raw state without a deep proxy.
 */
export class EditorStore {
  document: LabelDocument = $state.raw(undefined as unknown as LabelDocument);
  readonly selection = new SvelteSet<Id>();
  view: ViewState = $state(defaultView());
  /** An armed drawing tool: the next drag on the label draws that element instead of panning. */
  tool: InsertType | undefined = $state(undefined);
  canUndo = $state(false);
  canRedo = $state(false);
  undoLabel = $state<string | undefined>(undefined);
  redoLabel = $state<string | undefined>(undefined);
  readonly selectedElements: LabelElement[] = $derived(
    this.document ? this.document.elements.filter((item) => this.selection.has(item.id)) : [],
  );
  readonly #history: DocumentHistory;

  constructor(document: LabelDocument) {
    this.#history = new DocumentHistory(document);
    this.#sync(this.#history.state);
  }

  execute(command: Command): void {
    this.#sync(this.#history.execute(command));
  }
  undo(): void {
    this.#sync(this.#history.undo());
  }
  redo(): void {
    this.#sync(this.#history.redo());
  }
  replace(next: LabelDocument): void {
    this.#sync(this.#history.replace(next));
    this.selection.clear();
    this.view.zoomMode = 'fit';
  }
  select(ids: Iterable<Id>, additive = false): void {
    const next = [...ids];
    if (!additive) for (const id of [...this.selection]) if (!next.includes(id)) this.selection.delete(id);
    for (const id of next) this.selection.add(id);
  }
  clearSelection(): void {
    this.selection.clear();
  }
  setTool(tool: InsertType | undefined): void {
    this.tool = tool;
  }
  setView(patch: Partial<ViewState>): void {
    Object.assign(this.view, patch);
  }
  /**
   * Zooms by hand, keeping the label point under `anchor` (an offset from the
   * viewport centre, in pixels) where it is. Leaves fit mode.
   */
  setZoom(zoom: number, anchor: Point = { x: 0, y: 0 }): void {
    const next = clampZoom(zoom);
    const ratio = next / this.view.zoom;
    const pan = {
      x: this.view.pan.x + (anchor.x - this.view.pan.x) * (1 - ratio),
      y: this.view.pan.y + (anchor.y - this.view.pan.y) * (1 - ratio),
    };
    Object.assign(this.view, { zoom: next, pan, zoomMode: 'manual' });
  }

  #sync(state: HistoryState): void {
    if (state.document !== this.document) this.document = state.document;
    this.canUndo = state.canUndo;
    this.canRedo = state.canRedo;
    this.undoLabel = state.undoLabel;
    this.redoLabel = state.redoLabel;
  }
}

export const createEditorStore = (document: LabelDocument): EditorStore => new EditorStore(document);
