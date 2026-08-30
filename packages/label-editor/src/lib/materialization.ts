// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from './model.js';

export interface MaterializeOptions { locale?: string; currentDate?: string }
export interface ZoneBatchPlacement { record: number; page: number; zone: string }
export interface ZoneBatchPlan { pageCount: number; placements: ZoneBatchPlacement[] }
export interface ZoneBatchInput { recordCount: number; zoneIds: string[] }
export interface ZoneBatchOptions extends MaterializeOptions { zoneIds: string[] }
export interface DocumentMaterializer {
  materializeRecord(document: LabelDocument, record: Record<string, string>, options?: MaterializeOptions): Promise<LabelDocument>;
  planZoneBatch(document: LabelDocument, input: ZoneBatchInput): Promise<ZoneBatchPlan>;
  materializeZoneBatch(document: LabelDocument, records: Record<string, string>[], options: ZoneBatchOptions): Promise<LabelDocument[]>;
}
export class DocumentMaterializationError extends Error {
  constructor(readonly code: string, readonly details: Readonly<Record<string, number>> = {}) { super(message(code)); this.name = 'DocumentMaterializationError'; }
}
export function isZoneBatchPlan(value: unknown): value is ZoneBatchPlan {
  if (!record(value) || !Number.isSafeInteger(value.pageCount) || Number(value.pageCount) < 0 || !Array.isArray(value.placements)) return false;
  return value.placements.every((item) => record(item) && Number.isSafeInteger(item.record) && Number(item.record) >= 0 && Number.isSafeInteger(item.page) && Number(item.page) >= 0 && typeof item.zone === 'string' && item.zone.length > 0);
}
export function isZoneBatchPlanForRequest(value: unknown, input: ZoneBatchInput): value is ZoneBatchPlan {
  if (!isZoneBatchPlan(value) || !Number.isSafeInteger(input.recordCount) || input.recordCount < 0 || !input.zoneIds.length || new Set(input.zoneIds).size !== input.zoneIds.length) return false;
  const expectedPages = input.recordCount === 0 ? 0 : Math.ceil(input.recordCount / input.zoneIds.length);
  return value.pageCount === expectedPages && value.placements.length === input.recordCount && value.placements.every((item, index) => item.record === index && item.page === Math.floor(index / input.zoneIds.length) && item.page < value.pageCount && item.zone === input.zoneIds[index % input.zoneIds.length]);
}
export function structuredMaterializationError(error: unknown): DocumentMaterializationError {
  if (error instanceof DocumentMaterializationError) return error;
  if (!record(error) || error.version !== 1 || typeof error.code !== 'string' || !codes.has(error.code)) return new DocumentMaterializationError('materialize.unknown');
  const details: Record<string, number> = {};
  if (record(error.details)) for (const key of ['count', 'element', 'index']) if (Number.isSafeInteger(error.details[key]) && Number(error.details[key]) >= 0) details[key] = Number(error.details[key]);
  return new DocumentMaterializationError(error.code, details);
}
const codes = new Set(['request.invalid_json', 'request.encode_failed', 'request.input_too_large', 'materialize.invalid_document', 'materialize.template', 'materialize.limit_exceeded', 'batch.no_zones', 'batch.duplicate_zone', 'batch.unknown_zone']);
const messages: Record<string, string> = {'request.invalid_json':'The materialization request is invalid.','request.encode_failed':'The materialized document could not be encoded.','request.input_too_large':'The materialization request is too large.','materialize.invalid_document':'The label document is invalid.','materialize.template':'A template expression could not be evaluated.','materialize.limit_exceeded':'The materialized output exceeds the safe processing limits.','batch.no_zones':'Batch layout requires at least one zone.','batch.duplicate_zone':'A batch zone was selected more than once.','batch.unknown_zone':'A selected batch zone no longer exists.','materialize.unknown':'Document materialization failed.'};
const message = (code: string) => messages[code] ?? messages['materialize.unknown'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
