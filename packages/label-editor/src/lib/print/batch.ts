// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from '../model.js';
import {
  ContinuousPrintError,
  type BatchPrintProgress,
  type ContinuousPrintOptions,
  type PrinterDefinition,
  type PrintResult,
  type PrintRoute,
} from './types.js';

export type { BatchPrintProgress } from './types.js';

export interface BatchPrintRequest {
  documents: LabelDocument[];
  route: PrintRoute;
  printer: PrinterDefinition;
  copies: number;
  continuous?: ContinuousPrintOptions;
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
  const nativeBatch = !!request.route.printBatch && request.route.supportsNativeBatch !== false;
  if (request.continuous?.cutMode === 'after-job' && !nativeBatch) {
    throw new ContinuousPrintError(
      'continuous.batch_route_unsupported',
      'Cut after complete job requires native batch support from the selected print route.',
    );
  }
  if (nativeBatch && request.route.printBatch) {
    const result = await request.route.printBatch({
      documents: request.documents,
      printer: request.printer,
      copies: request.copies,
      continuous: request.continuous,
      signal: request.signal,
      onProgress: request.onProgress,
    });
    return { completed: result.outcome === 'completed' ? request.documents.length : 0, result };
  }
  let completed = 0;
  for (const document of request.documents) {
    if (request.signal?.aborted) {
      return {
        completed,
        result: {
          outcome: 'cancelled-before-send',
          lastCompletedAction: -1,
          bytesSent: 0,
          error: 'Batch stopped before the next label.',
        },
      };
    }
    const result = await request.route.print({
      document,
      printer: request.printer,
      copies: request.copies,
      continuous: request.continuous,
      signal: request.signal,
      onProgress: (current) =>
        request.onProgress?.({
          item: completed,
          items: request.documents.length,
          copy: 0,
          copies: request.copies,
          current,
        }),
    });
    if (result.outcome !== 'completed') return { completed, result };
    completed++;
  }
  return { completed, result: { outcome: 'completed', lastCompletedAction: -1, bytesSent: 0 } };
}
