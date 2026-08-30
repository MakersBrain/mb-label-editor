// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from '../model.js';
import type { SheetDefinition, SheetLayoutPreset, SheetPlanInput } from './types.js';

const PAPER_UM = {
  a4: { portrait: [210_000, 297_000], landscape: [297_000, 210_000] },
  letter: { portrait: [215_900, 279_400], landscape: [279_400, 215_900] }
} as const;

export function millimetresToMicrometres(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Sheet dimensions must be finite numbers.');
  const scaled = Math.abs(value) * 1000;
  const rounded = Math.sign(value) * Math.floor(scaled + 0.5);
  if (!Number.isSafeInteger(rounded)) throw new Error('Sheet dimensions exceed the supported range.');
  return rounded;
}

export function presetToDefinition(preset: SheetLayoutPreset): SheetDefinition {
  if (!preset.id.trim()) throw new Error('Sheet layout ID is required.');
  const paper = preset.paper === 'custom' ? undefined : PAPER_UM[preset.paper][preset.orientation];
  if (!paper) throw new Error('Custom paper requires an explicit editor-defined size.');
  const [paperWidthUm, paperHeightUm] = paper;
  if ((preset.grid ? 1 : 0) + (preset.slots ? 1 : 0) !== 1) {
    throw new Error('A sheet layout must define exactly one grid or slot list.');
  }
  if (preset.grid) {
    const grid = preset.grid;
    const rows = checkedCount(grid.rows, 'rows');
    const columns = checkedCount(grid.columns, 'columns');
    if (rows * columns > 10_000) throw new Error('A sheet grid cannot contain more than 10000 slots.');
    if (!['row-major', 'column-major'].includes(grid.fillOrder)) throw new Error('Invalid sheet fill order.');
    const definition: SheetDefinition = {
      kind: 'grid', id: preset.id, paperWidthUm, paperHeightUm,
      rows, columns,
      labelWidthUm: positiveUm(grid.labelWidthMm, 'label width'),
      labelHeightUm: positiveUm(grid.labelHeightMm, 'label height'),
      marginLeftUm: nonNegativeUm(grid.marginLeftMm, 'left margin'),
      marginTopUm: nonNegativeUm(grid.marginTopMm, 'top margin'),
      gapXUm: nonNegativeUm(grid.gapXMm, 'horizontal gap'),
      gapYUm: nonNegativeUm(grid.gapYMm, 'vertical gap'),
      fillOrder: grid.fillOrder
    };
    assertGridFits(definition);
    return definition;
  }
  if (!preset.slots?.length) throw new Error('An explicit sheet layout requires at least one slot.');
  const definition: SheetDefinition = {
    kind: 'explicit', id: preset.id, paperWidthUm, paperHeightUm,
    slots: preset.slots!.map((slot) => ({
      xUm: nonNegativeUm(slot.xMm, 'slot x'), yUm: nonNegativeUm(slot.yMm, 'slot y'),
      widthUm: positiveUm(slot.widthMm, 'slot width'), heightUm: positiveUm(slot.heightMm, 'slot height')
    }))
  };
  for (const slot of definition.slots) {
    if (slot.xUm > paperWidthUm - slot.widthUm || slot.yUm > paperHeightUm - slot.heightUm) {
      throw new Error('A sheet slot extends outside the paper.');
    }
  }
  return definition;
}

export function sheetPlanInput(document: LabelDocument, itemCount: number): SheetPlanInput {
  return {
    itemCount: checkedCount(itemCount, 'item count'),
    labelWidthUm: positiveUm(document.media.width, 'label width'),
    labelHeightUm: positiveUm(document.media.height, 'label height')
  };
}

function checkedCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000) throw new Error(`${name} must be an integer between 1 and 1000.`);
  return value;
}

function assertGridFits(definition: Extract<SheetDefinition, { kind: 'grid' }>): void {
  const right = definition.marginLeftUm + definition.columns * definition.labelWidthUm + (definition.columns - 1) * definition.gapXUm;
  const bottom = definition.marginTopUm + definition.rows * definition.labelHeightUm + (definition.rows - 1) * definition.gapYUm;
  if (!Number.isSafeInteger(right) || !Number.isSafeInteger(bottom)) throw new Error('Sheet grid dimensions exceed the supported range.');
  if (right > definition.paperWidthUm || bottom > definition.paperHeightUm) throw new Error('The sheet grid extends outside the paper.');
}

function positiveUm(value: number, name: string): number {
  const result = millimetresToMicrometres(value);
  if (result <= 0) throw new Error(`${name} must be positive.`);
  return result;
}

function nonNegativeUm(value: number, name: string): number {
  const result = millimetresToMicrometres(value);
  if (result < 0) throw new Error(`${name} cannot be negative.`);
  return result;
}
