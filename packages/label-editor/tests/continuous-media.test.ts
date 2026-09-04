// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  ContinuousMediaError,
  continuousSettings,
  defaultDocument,
  documentLayoutFingerprint,
  fromSdkDocument,
  isResolvedLabelDocument,
  printableBoundsForResizedMedia,
  resolveContinuousBatch,
  resolveContinuousDocument,
  resolutionStamp,
  prepareDocumentForOutput,
  serializeDocument,
  toSdkDocument,
  validateContinuousMedia,
  type DocumentMeasurement,
} from '../src/index.js';

const measurement = (bottom: number, top = 3): DocumentMeasurement => ({
  layoutVersion: 'test-layout-v1',
  elements: [
    { instanceId: 'item', sourceElementId: 'item', bounds: { x: 2, y: top, width: 10, height: bottom - top } },
  ],
});

function continuous() {
  const document = defaultDocument('2026-01-01T00:00:00Z');
  document.media.shape = 'continuous';
  document.media.continuousSettings = {
    version: 1,
    lengthMode: 'fit-content',
    fixedLengthMm: 30,
    leadingMarginMm: 2,
    trailingMarginMm: 3,
    batchLengthMode: 'per-record',
  };
  return document;
}

describe('continuous media resolution', () => {
  it('resolves measured content without mutating the authored document', () => {
    const source = continuous();
    const result = resolveContinuousDocument(source, measurement(20), {
      minimumLengthMm: 10,
      maximumLengthMm: 100,
      source: 'printer',
      printerModel: 'test',
    });
    expect(result.resolvedLengthMm).toBe(23);
    expect(result.document.media.height).toBe(23);
    expect(result.document.media.printableBounds.height).toBe(23);
    expect(source.media.height).toBe(30);
    expect(isResolvedLabelDocument(result.document)).toBe(true);
    expect(resolutionStamp(result.document)).toMatchObject({
      layoutVersion: 'test-layout-v1',
      qualifiedPrinterModel: 'test',
    });
    expect(isResolvedLabelDocument(structuredClone(result.document))).toBe(false);
  });

  it('preserves printable top and bottom insets', () => {
    const source = continuous();
    source.media.printableBounds = { x: 1, y: 2, width: 48, height: 25 };
    const result = resolveContinuousDocument(source, measurement(20), {
      minimumLengthMm: 10,
      maximumLengthMm: 100,
      source: 'printer',
    });
    expect(result.document.media.printableBounds).toEqual({ x: 1, y: 2, width: 48, height: 18 });
  });

  it('preserves every printable inset when authored media is resized', () => {
    const source = continuous();
    source.media.width = 50;
    source.media.height = 30;
    source.media.printableBounds = { x: 1, y: 2, width: 46, height: 23 };

    expect(printableBoundsForResizedMedia(source.media, 60, 40)).toEqual({
      x: 1,
      y: 2,
      width: 56,
      height: 33,
    });
  });

  it('never clamps oversized content down to the maximum', () => {
    const source = continuous();
    expect(() =>
      resolveContinuousDocument(source, measurement(99), {
        minimumLengthMm: 10,
        maximumLengthMm: 100,
        source: 'printer',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'continuous.content_exceeds_maximum' } satisfies Partial<ContinuousMediaError>),
    );
  });

  it('uses the effective preferred range and minimum for empty content', () => {
    const source = continuous();
    source.media.continuousSettings!.preferredMinimumLengthMm = 15;
    source.media.continuousSettings!.preferredMaximumLengthMm = 80;
    const result = resolveContinuousDocument(
      source,
      { layoutVersion: 'test', elements: [] },
      { minimumLengthMm: 10, maximumLengthMm: 100, source: 'printer' },
    );
    expect(result.resolvedLengthMm).toBe(15);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'continuous.empty_content' }));
  });

  it('warns instead of expanding fixed labels whose content crosses the cut line', () => {
    const source = continuous();
    source.media.continuousSettings!.lengthMode = 'fixed';
    source.media.continuousSettings!.fixedLengthMm = 30;
    const result = resolveContinuousDocument(source, measurement(35), {
      minimumLengthMm: 10,
      maximumLengthMm: 100,
      source: 'printer',
    });
    expect(result.resolvedLengthMm).toBe(30);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'continuous.content_after_cut_line' }));
  });

  it('resolves a batch per record or to the longest result', () => {
    const first = continuous();
    const second = continuous();
    const limits = { minimumLengthMm: 10, maximumLengthMm: 100, source: 'printer' as const };
    expect(
      resolveContinuousBatch([first, second], [measurement(20), measurement(30)], 'per-record', limits).map(
        (item) => item.resolvedLengthMm,
      ),
    ).toEqual([23, 33]);
    const uniform = resolveContinuousBatch(
      [first, second],
      [measurement(20), measurement(30)],
      'uniform-longest',
      limits,
    );
    expect(uniform.map((item) => item.resolvedLengthMm)).toEqual([33, 33]);
    expect(uniform.every((item) => item.document.media.continuousSettings?.lengthMode === 'fit-content')).toBe(true);
  });

  it('keeps canonical Y as feed direction in portrait and landscape', () => {
    const lengths = (['portrait', 'landscape'] as const).map((orientation) => {
      const source = continuous();
      source.media.orientation = orientation;
      return resolveContinuousDocument(source, measurement(20), {
        minimumLengthMm: 10,
        maximumLengthMm: 100,
        source: 'printer',
      }).resolvedLengthMm;
    });
    expect(lengths).toEqual([23, 23]);
  });

  it('rounds resolved millimetres to the canonical micrometre grid', () => {
    const source = continuous();
    const result = resolveContinuousDocument(source, measurement(20.1236), {
      minimumLengthMm: 10,
      maximumLengthMm: 100,
      source: 'printer',
    });
    expect(result.resolvedLengthMm).toBe(23.124);
    expect(toSdkDocument(result.document).media.height).toBe(23_124);
  });

  it('exposes authored validation without requiring a measurement', () => {
    const source = continuous();
    expect(validateContinuousMedia(source, { minimumLengthMm: 10, maximumLengthMm: 100, source: 'printer' })).toEqual(
      [],
    );
    source.media.width = 0;
    expect(() => validateContinuousMedia(source)).toThrowError(
      expect.objectContaining({ code: 'continuous.invalid_width' }),
    );
  });
});

describe('continuous settings serialization', () => {
  it('keeps editor settings in metadata while canonical media stays strict', () => {
    const source = continuous();
    const canonical = toSdkDocument(source);
    expect(canonical.media).not.toHaveProperty('continuousSettings');
    expect(
      (canonical.extensions['makersbrain.editor:state'] as { continuousSettings?: unknown }).continuousSettings,
    ).toEqual(source.media.continuousSettings);
    expect(fromSdkDocument(canonical).media.continuousSettings).toEqual(source.media.continuousSettings);
  });

  it('rejects unresolved fit-content JSON and serializes a prepared document', () => {
    const source = continuous();
    expect(() => serializeDocument(source)).toThrowError(
      expect.objectContaining({ code: 'continuous.unresolved_document' }),
    );
    expect(() => serializeDocument(resolveContinuousDocument(source, measurement(20)).document)).not.toThrow();
  });

  it('resolves from the current record while preserving template authoring data for JSON', async () => {
    const source = continuous();
    source.template = { fields: ['name'], records: [{ name: 'short' }, { name: 'long' }], currentRecord: 1 };
    source.elements = [
      {
        id: 'text',
        name: '{{name}}',
        type: 'text',
        text: '{{name}}',
        fontFamily: 'sans-serif',
        fontSize: 3,
        fontWeight: 400,
        horizontalAlign: 'left',
        verticalAlign: 'top',
        overflow: 'auto-height',
        transform: { x: 0, y: 0, width: 20, height: 5, rotation: 0 },
        zIndex: 0,
        visible: true,
        locked: false,
      },
    ];
    let measuredText = '';
    const prepared = await prepareDocumentForOutput(
      source,
      {
        materializer: {
          materializeRecord: async (document, record) => {
            const copy = structuredClone(document);
            const text = copy.elements[0];
            if (text?.type === 'text') text.text = record.name;
            return copy;
          },
        },
        measurer: {
          measure: async (document) => {
            const text = document.elements[0];
            measuredText = text?.type === 'text' ? text.text : '';
            return measurement(25);
          },
        },
      },
      { preserveTemplateSource: true },
    );
    expect(measuredText).toBe('long');
    expect(prepared.document.elements[0]).toMatchObject({ text: '{{name}}' });
    expect(prepared.document.template?.records).toHaveLength(2);
    expect(prepared.document.media.height).toBe(28);
    expect(() => serializeDocument(prepared.document)).not.toThrow();
  });

  it('normalizes invalid SDK zone graphs to the stable resolution code', async () => {
    await expect(
      prepareDocumentForOutput(continuous(), {
        measurer: {
          measure: async () => {
            throw new Error('group or zone cycle: clone-a');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'continuous.invalid_zone' });
  });
});

describe('layout fingerprint', () => {
  it('is stable across key order and memoised settings, and changes when layout changes', () => {
    const base = defaultDocument('2026-01-01T00:00:00Z');
    base.elements = [
      {
        id: 'a',
        name: 'a',
        type: 'rectangle',
        transform: { x: 1, y: 1, width: 5, height: 5, rotation: 0 },
        zIndex: 0,
        visible: true,
        locked: false,
        strokeWidth: 0.2,
        filled: false,
      },
    ];
    const reordered = JSON.parse(
      JSON.stringify({
        ...base,
        elements: base.elements.map((item) => ({
          zIndex: item.zIndex,
          id: item.id,
          transform: item.transform,
          name: item.name,
          type: item.type,
          visible: item.visible,
          locked: item.locked,
          strokeWidth: 0.2,
          filled: false,
        })),
      }),
    ) as typeof base;
    expect(documentLayoutFingerprint(reordered)).toBe(documentLayoutFingerprint(base));
    expect(documentLayoutFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
    const moved = { ...base, elements: [{ ...base.elements[0], transform: { ...base.elements[0].transform, x: 2 } }] };
    expect(documentLayoutFingerprint(moved)).not.toBe(documentLayoutFingerprint(base));
    expect(continuousSettings(base)).toBe(continuousSettings(base));
  });
});
