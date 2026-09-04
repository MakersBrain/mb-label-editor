// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { addElement, defaultDocument, EditorStore, moveElements, type LabelElement } from '../src/index.js';

const shape = (id: string, x: number): LabelElement => ({
  id,
  name: id,
  type: 'rectangle',
  transform: { x, y: 1, width: 5, height: 5, rotation: 0 },
  zIndex: 0,
  visible: true,
  locked: false,
  strokeWidth: 0.2,
  filled: false,
});

describe('runes editor store', () => {
  it('replaces the document identity on commands and derives the selection', () => {
    const editor = new EditorStore(defaultDocument('2026-01-01T00:00:00Z'));
    const original = editor.document;
    editor.execute(addElement(shape('a', 2)));
    expect(editor.document).not.toBe(original);
    expect(editor.canUndo).toBe(true);
    editor.select(['a']);
    expect(editor.selectedElements.map((item) => item.id)).toEqual(['a']);
    editor.execute(moveElements(['a'], { x: 1, y: 0 }));
    expect(editor.selectedElements[0].transform.x).toBe(3);
    editor.select(['missing'], true);
    expect([...editor.selection]).toEqual(['a', 'missing']);
    editor.clearSelection();
    expect(editor.selectedElements).toEqual([]);
    editor.undo();
    editor.undo();
    expect(editor.document).toBe(original);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(true);
  });

  it('patches the view without replacing untouched fields', () => {
    const editor = new EditorStore(defaultDocument());
    editor.setView({ zoom: 2 });
    expect(editor.view.zoom).toBe(2);
    expect(editor.view.gridSize).toBe(1);
    editor.setView({ guides: [{ axis: 'x', value: 4 }] });
    expect(editor.view.guides).toEqual([{ axis: 'x', value: 4 }]);
  });
});
