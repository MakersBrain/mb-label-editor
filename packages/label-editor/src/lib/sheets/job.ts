// SPDX-License-Identifier: AGPL-3.0-or-later
import { cloneDocument, type LabelDocument } from '../model.js';
import { materializeRecord } from '../template/materialize.js';

export type SheetJobSelection = { mode: 'copies'; copies: number } | { mode: 'records'; recordIndexes?: number[] };

export function materializeSheetJob(document: LabelDocument, selection: SheetJobSelection): LabelDocument[] {
  if (selection.mode === 'copies') {
    const copies = boundedCount(selection.copies, 'copies');
    return Array.from({ length: copies }, () => cloneDocument(document));
  }
  const records = document.template?.records ?? [];
  const indexes = selection.recordIndexes ?? records.map((_, index) => index);
  if (!indexes.length) throw new Error('Import or select at least one CSV record.');
  return indexes.map((index) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= records.length) {
      throw new Error(`Unknown template record ${index}.`);
    }
    return materializeRecord(document, index);
  });
}

function boundedCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new Error(`${name} must be between 1 and 1000.`);
  }
  return value;
}
