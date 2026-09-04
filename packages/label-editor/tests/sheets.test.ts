// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultDocument } from '../src/lib/model.js';
import { sheetLayoutPreset, sheetLayoutPresets } from '../src/lib/sheets/catalogue.js';
import { materializeSheetJob } from '../src/lib/sheets/job.js';
import { millimetresToMicrometres, presetToDefinition, sheetPlanInput } from '../src/lib/sheets/normalize.js';
import {
  isSheetLayoutPreset,
  isSheetPlan,
  isSheetPlanForRequest,
  type SheetDefinition,
  type SheetLayoutPreset,
} from '../src/lib/sheets/types.js';

describe('classic sheet domain', () => {
  it('normalizes physical dimensions to exact integer micrometres', () => {
    expect(millimetresToMicrometres(66.675)).toBe(66_675);
    expect(millimetresToMicrometres(-0.0005)).toBe(-1);
    const preset = sheetLayoutPreset('a4-70x36-3x8')!;
    expect(presetToDefinition(preset)).toMatchObject({
      kind: 'grid',
      paperWidthUm: 210_000,
      paperHeightUm: 297_000,
      labelWidthUm: 70_000,
      labelHeightUm: 36_000,
      marginTopUm: 4_500,
    });
  });

  it('ships only valid one-shape generic presets', () => {
    for (const preset of sheetLayoutPresets()) {
      expect(isSheetLayoutPreset(preset)).toBe(true);
      expect(() => presetToDefinition(preset)).not.toThrow();
      expect(Number(!!preset.grid) + Number(!!preset.slots)).toBe(1);
      const definition = presetToDefinition(preset);
      if (definition.kind === 'grid') {
        const right =
          definition.marginLeftUm +
          definition.columns * definition.labelWidthUm +
          (definition.columns - 1) * definition.gapXUm;
        const bottom =
          definition.marginTopUm +
          definition.rows * definition.labelHeightUm +
          (definition.rows - 1) * definition.gapYUm;
        expect(right).toBeLessThanOrEqual(definition.paperWidthUm);
        expect(bottom).toBeLessThanOrEqual(definition.paperHeightUm);
      }
    }
  });

  it('returns isolated preset copies and rejects layouts outside the paper', () => {
    const first = sheetLayoutPresets();
    first[0].name = 'changed';
    expect(sheetLayoutPresets()[0].name).not.toBe('changed');
    const invalid = structuredClone(sheetLayoutPreset('a4-70x36-3x8')!);
    invalid.grid!.marginLeftMm = 1;
    expect(() => presetToDefinition(invalid)).toThrow(/outside the paper/);
    const explicit: SheetLayoutPreset = {
      id: 'outside',
      name: 'Outside',
      paper: 'a4',
      orientation: 'portrait',
      slots: [{ xMm: 209, yMm: 0, widthMm: 2, heightMm: 1 }],
    };
    expect(() => presetToDefinition(explicit)).toThrow(/outside the paper/);
  });

  it('builds lightweight plans and deterministic copy/record jobs', () => {
    const document = defaultDocument();
    document.media.width = 70;
    document.media.height = 36;
    expect(sheetPlanInput(document, 3)).toEqual({ itemCount: 3, labelWidthUm: 70_000, labelHeightUm: 36_000 });
    expect(materializeSheetJob(document, { mode: 'copies', copies: 2 })).toHaveLength(2);
    document.template = { fields: ['name'], records: [{ name: 'Ada' }, { name: 'Grace' }], currentRecord: 0 };
    expect(materializeSheetJob(document, { mode: 'records', recordIndexes: [1, 0] })).toHaveLength(2);
  });

  it('guards the sheet-plan boundary at runtime', () => {
    expect(
      isSheetPlan({
        pageCount: 1,
        layout: { id: 'x', paperWidthUm: 1, paperHeightUm: 1, slots: [{ xUm: 0, yUm: 0, widthUm: 1, heightUm: 1 }] },
        placements: [{ item: 0, page: 0, slot: 0 }],
      }),
    ).toBe(true);
    expect(
      isSheetPlan({
        pageCount: 1,
        layout: { id: 'x', paperWidthUm: 1, paperHeightUm: 1, slots: [] },
        placements: [{ item: -1, page: 0, slot: 0 }],
      }),
    ).toBe(false);
    expect(
      isSheetPlan({
        pageCount: 1,
        layout: { id: 'x', paperWidthUm: 10, paperHeightUm: 10, slots: [{ xUm: 9, yUm: 0, widthUm: 2, heightUm: 1 }] },
        placements: [{ item: 0, page: 0, slot: 0 }],
      }),
    ).toBe(false);
    expect(
      isSheetPlan({
        pageCount: 1,
        layout: { id: 'x', paperWidthUm: 10, paperHeightUm: 10, slots: [{ xUm: 0, yUm: 0, widthUm: 1, heightUm: 1 }] },
        placements: [{ item: 0, page: 0, slot: 1 }],
      }),
    ).toBe(false);
    expect(
      isSheetPlan({
        pageCount: 1,
        layout: { id: 'x', paperWidthUm: 10, paperHeightUm: 10, slots: [{ xUm: 0, yUm: 0, widthUm: 1, heightUm: 1 }] },
        placements: [
          { item: 0, page: 0, slot: 0 },
          { item: 0, page: 0, slot: 0 },
        ],
      }),
    ).toBe(false);
  });

  it('rejects valid-looking plans that do not match the exact request', () => {
    const layout: SheetDefinition = {
      kind: 'explicit',
      id: 'two',
      paperWidthUm: 20,
      paperHeightUm: 10,
      slots: [
        { xUm: 0, yUm: 0, widthUm: 10, heightUm: 10 },
        { xUm: 10, yUm: 0, widthUm: 10, heightUm: 10 },
      ],
    };
    const input = { itemCount: 2, labelWidthUm: 10, labelHeightUm: 10 };
    const options = { firstSlot: 1, dpi: 300 };
    const valid = {
      pageCount: 2,
      layout: { id: layout.id, paperWidthUm: 20, paperHeightUm: 10, slots: layout.slots },
      placements: [
        { item: 0, page: 0, slot: 1 },
        { item: 1, page: 1, slot: 0 },
      ],
    };
    expect(isSheetPlanForRequest(valid, input, layout, options)).toBe(true);
    expect(
      isSheetPlanForRequest(
        { ...valid, placements: [{ item: 0, page: 0, slot: 0 }, valid.placements[1]] },
        input,
        layout,
        options,
      ),
    ).toBe(false);
    expect(isSheetPlanForRequest({ ...valid, pageCount: 3 }, input, layout, options)).toBe(false);
  });

  it('validates preset wire shapes without trusting TypeScript casts', () => {
    expect(
      isSheetLayoutPreset({
        id: 'x',
        name: 'X',
        paper: 'a4',
        orientation: 'portrait',
        grid: {
          rows: 1,
          columns: 1,
          labelWidthMm: 10,
          labelHeightMm: 10,
          marginLeftMm: 0,
          marginTopMm: 0,
          gapXMm: 0,
          gapYMm: 0,
          fillOrder: 'row-major',
        },
      }),
    ).toBe(true);
    expect(isSheetLayoutPreset({ id: 'x', name: 'X', paper: 'a4', orientation: 'portrait', grid: { rows: 1.5 } })).toBe(
      false,
    );
    expect(isSheetLayoutPreset({ id: 'x', name: 'X', paper: 'a4', orientation: 'sideways', slots: [] })).toBe(false);
  });
});
