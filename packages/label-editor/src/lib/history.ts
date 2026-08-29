// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Command } from './commands.js';
import type { LabelDocument } from './model.js';
import { cloneDocument } from './model.js';

export interface HistoryState { document: LabelDocument; undoLabel?: string; redoLabel?: string; canUndo: boolean; canRedo: boolean }
interface Entry { label: string; before: LabelDocument; after: LabelDocument }
export class DocumentHistory {
  #document: LabelDocument; #undo: Entry[] = []; #redo: Entry[] = [];
  constructor(document: LabelDocument, readonly limit = 100) { this.#document = cloneDocument(document); }
  get document() { return cloneDocument(this.#document); }
  get state(): HistoryState { return { document: this.document, canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0, undoLabel: this.#undo.at(-1)?.label, redoLabel: this.#redo.at(-1)?.label }; }
  execute(command: Command) { const before = this.document; const after = command.apply(before); this.#undo.push({ label: command.label, before, after }); if (this.#undo.length > this.limit) this.#undo.shift(); this.#redo = []; this.#document = after; return this.state; }
  undo() { const entry = this.#undo.pop(); if (entry) { this.#redo.push(entry); this.#document = entry.before; } return this.state; }
  redo() { const entry = this.#redo.pop(); if (entry) { this.#undo.push(entry); this.#document = entry.after; } return this.state; }
  replace(document: LabelDocument) { this.#document = cloneDocument(document); this.#undo = []; this.#redo = []; return this.state; }
}
