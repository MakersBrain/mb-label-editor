// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from '../model.js';
import type { PrinterDefinition, PrintProgress, PrintResult, PrintRoute } from './types.js';

export interface BatchPrintProgress {
  item: number;
  items: number;
  current: PrintProgress;
}

export interface BatchPrintRequest {
  documents: LabelDocument[];
  route: PrintRoute;
  printer: PrinterDefinition;
  copies: number;
  signal?: AbortSignal;
  onProgress?: (progress: BatchPrintProgress) => void;
}

export interface BatchPrintResult {
  completed: number;
  result: PrintResult;
}

export async function executeBatch(request: BatchPrintRequest): Promise<BatchPrintResult> {
  if (!request.documents.length) throw new Error('Batch printing requires at least one document.');
  if (!Number.isSafeInteger(request.copies) || request.copies < 1 || request.copies > 100) {
    throw new Error('Copies must be between 1 and 100.');
  }
  let completed = 0;
  for (const document of request.documents) {
    if (request.signal?.aborted) {
      return { completed, result: { outcome: 'cancelled-before-send', lastCompletedAction: -1, bytesSent: 0, error: 'Batch stopped before the next label.' } };
    }
    const result = await request.route.print({
      document, printer: request.printer, copies: request.copies, signal: request.signal,
      onProgress: (current) => request.onProgress?.({ item: completed, items: request.documents.length, current })
    });
    if (result.outcome !== 'completed') return { completed, result };
    completed++;
  }
  return { completed, result: { outcome: 'completed', lastCompletedAction: -1, bytesSent: 0 } };
}
