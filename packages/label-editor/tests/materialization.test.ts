// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DocumentMaterializationError, isZoneBatchPlanForRequest, structuredMaterializationError } from '../src/lib/materialization.js';

describe('materialization boundary', () => {
  it('accepts only the exact contiguous Rust placement for the request', () => {
    const input = { recordCount: 3, zoneIds: ['left', 'right'] };
    const plan = { pageCount: 2, placements: [{ record: 0, page: 0, zone: 'left' }, { record: 1, page: 0, zone: 'right' }, { record: 2, page: 1, zone: 'left' }] };
    expect(isZoneBatchPlanForRequest(plan, input)).toBe(true);
    expect(isZoneBatchPlanForRequest({ ...plan, placements: [plan.placements[0], plan.placements[0], plan.placements[2]] }, input)).toBe(false);
    expect(isZoneBatchPlanForRequest({ ...plan, placements: plan.placements.map((item) => ({ ...item, page: 2 })) }, input)).toBe(false);
    expect(isZoneBatchPlanForRequest({ ...plan, placements: plan.placements.slice(1) }, input)).toBe(false);
  });
  it('allowlists wasm failure fields and replaces raw messages', () => {
    const error = structuredMaterializationError({ version: 1, code: 'batch.unknown_zone', message: 'secret document value', details: { index: 2, secret: 9 } });
    expect(error).toBeInstanceOf(DocumentMaterializationError);
    expect(error).toMatchObject({ code: 'batch.unknown_zone', details: { index: 2 } });
    expect(error.message).not.toContain('secret');
    expect(structuredMaterializationError(new Error('raw printer response')).code).toBe('materialize.unknown');
  });
});
