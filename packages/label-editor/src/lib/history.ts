// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Command } from './commands.js';
import type { LabelDocument } from './model.js';
import { cloneDocument, freezeDocument } from './model.js';

export interface HistoryState { document: LabelDocument; undoLabel?: string; redoLabel?: string; canUndo: boolean; canRedo: boolean }
/** Entries reference documents; consecutive documents share untouched resources and fonts by reference. */
interface Entry { label: string; coalesceKey?: string; before: LabelDocument; after: LabelDocument }
/**
 * Documents held by the history are immutable: commands return a new document
 * (or the same one when nothing changed) and readers get the stored object
 * without a defensive clone.
 */
export class DocumentHistory {
  #document: LabelDocument; #undo: Entry[] = []; #redo: Entry[] = [];
  constructor(document: LabelDocument, readonly limit = 100) { this.#document = freezeDocument(cloneDocument(document)); }
  get document() { return this.#document; }
  get state(): HistoryState { return { document: this.#document, canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0, undoLabel: this.#undo.at(-1)?.label, redoLabel: this.#redo.at(-1)?.label }; }
  execute(command: Command) {
    const before = this.#document; const after = command.apply(before);
    if (after === before) return this.state;
    freezeDocument(after);
    const previous = this.#undo.at(-1);
    if (command.coalesceKey && previous?.coalesceKey === command.coalesceKey && this.#redo.length === 0) {
      previous.after = after;
      previous.label = command.label;
    } else {
      this.#undo.push({ label: command.label, coalesceKey: command.coalesceKey, before, after });
      if (this.#undo.length > this.limit) this.#undo.shift();
    }
    this.#redo = []; this.#document = after; return this.state;
  }
  undo() { const entry = this.#undo.pop(); if (entry) { this.#redo.push(entry); this.#document = entry.before; } return this.state; }
  redo() { const entry = this.#redo.pop(); if (entry) { this.#undo.push(entry); this.#document = entry.after; } return this.state; }
  replace(document: LabelDocument) { this.#document = freezeDocument(cloneDocument(document)); this.#undo = []; this.#redo = []; return this.state; }
}
