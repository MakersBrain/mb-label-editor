// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from '../model.js';

export type SheetFillOrder = 'row-major' | 'column-major';
export type SheetPaper = 'a4' | 'letter' | 'custom';
export type SheetOrientation = 'portrait' | 'landscape';

export interface SheetSlot {
  xUm: number;
  yUm: number;
  widthUm: number;
  heightUm: number;
}

export interface SheetGridDefinition {
  kind: 'grid';
  id: string;
  paperWidthUm: number;
  paperHeightUm: number;
  rows: number;
  columns: number;
  labelWidthUm: number;
  labelHeightUm: number;
  marginLeftUm: number;
  marginTopUm: number;
  gapXUm: number;
  gapYUm: number;
  fillOrder: SheetFillOrder;
}

export interface SheetExplicitDefinition {
  kind: 'explicit';
  id: string;
  paperWidthUm: number;
  paperHeightUm: number;
  slots: SheetSlot[];
}

export type SheetDefinition = SheetGridDefinition | SheetExplicitDefinition;

export interface SheetPlanInput {
  itemCount: number;
  labelWidthUm: number;
  labelHeightUm: number;
}

export interface SheetOptions {
  firstSlot: number;
  dpi: number;
}

export interface SheetPlan {
  pageCount: number;
  layout: { id: string; paperWidthUm: number; paperHeightUm: number; slots: SheetSlot[] };
  placements: Array<{ item: number; page: number; slot: number }>;
}

export interface SheetLayoutPreset {
  id: string;
  name: string;
  paper: SheetPaper;
  orientation: SheetOrientation;
  grid?: {
    rows: number;
    columns: number;
    labelWidthMm: number;
    labelHeightMm: number;
    marginLeftMm: number;
    marginTopMm: number;
    gapXMm: number;
    gapYMm: number;
    fillOrder: SheetFillOrder;
  };
  slots?: Array<{ xMm: number; yMm: number; widthMm: number; heightMm: number }>;
}

export interface SheetPreferencesV1 {
  version: 1;
  layoutId: string;
  fillOrder: SheetFillOrder;
  lastCustomGrid?: NonNullable<SheetLayoutPreset['grid']>;
}

export interface SheetExporter {
  planSheet(input: SheetPlanInput, layout: SheetDefinition, options: SheetOptions): Promise<SheetPlan>;
  exportSheetPdf(documents: LabelDocument[], layout: SheetDefinition, options: SheetOptions): Promise<Uint8Array>;
}

export interface SheetDiagnostic {
  operation: 'plan' | 'export';
  outcome: 'completed' | 'failed';
  durationMs: number;
  pages?: number;
  items: number;
  errorCode?: string;
}

export function isSheetLayoutPreset(value: unknown): value is SheetLayoutPreset {
  if (!value || typeof value !== 'object') return false;
  const preset = value as Partial<SheetLayoutPreset>;
  if (
    typeof preset.id !== 'string' ||
    !preset.id.trim() ||
    typeof preset.name !== 'string' ||
    !preset.name.trim() ||
    !['a4', 'letter', 'custom'].includes(String(preset.paper)) ||
    !['portrait', 'landscape'].includes(String(preset.orientation))
  )
    return false;
  if (Number(!!preset.grid) + Number(!!preset.slots) !== 1) return false;
  if (preset.grid) {
    const grid = preset.grid;
    return (
      Number.isSafeInteger(grid.rows) &&
      grid.rows > 0 &&
      Number.isSafeInteger(grid.columns) &&
      grid.columns > 0 &&
      [grid.labelWidthMm, grid.labelHeightMm].every(isPositiveFinite) &&
      [grid.marginLeftMm, grid.marginTopMm, grid.gapXMm, grid.gapYMm].every(isNonNegativeFinite) &&
      ['row-major', 'column-major'].includes(grid.fillOrder)
    );
  }
  return (
    Array.isArray(preset.slots) &&
    preset.slots.length > 0 &&
    preset.slots.every(
      (slot) =>
        !!slot &&
        typeof slot === 'object' &&
        [slot.xMm, slot.yMm].every(isNonNegativeFinite) &&
        [slot.widthMm, slot.heightMm].every(isPositiveFinite),
    )
  );
}

export function isSheetPlan(value: unknown): value is SheetPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<SheetPlan>;
  const layout = plan.layout;
  if (!(
    Number.isSafeInteger(plan.pageCount) &&
    plan.pageCount! > 0 &&
    !!layout &&
    typeof layout.id === 'string' &&
    Number.isSafeInteger(layout.paperWidthUm) &&
    layout.paperWidthUm > 0 &&
    Number.isSafeInteger(layout.paperHeightUm) &&
    layout.paperHeightUm > 0 &&
    Array.isArray(layout.slots) &&
    layout.slots.length > 0 &&
    layout.slots.every(
      (slot) =>
        isSheetSlot(slot) &&
        slot.xUm <= layout.paperWidthUm - slot.widthUm &&
        slot.yUm <= layout.paperHeightUm - slot.heightUm,
    ) &&
    Array.isArray(plan.placements) &&
    plan.placements.length > 0 &&
    plan.placements.every(
      (placement) =>
        Number.isSafeInteger(placement.item) &&
        placement.item >= 0 &&
        Number.isSafeInteger(placement.page) &&
        placement.page >= 0 &&
        placement.page < plan.pageCount! &&
        Number.isSafeInteger(placement.slot) &&
        placement.slot >= 0 &&
        placement.slot < layout.slots.length,
    )
  ))
    return false;
  const items = new Set(plan.placements.map((placement) => placement.item));
  if (items.size !== plan.placements.length || Math.max(...items) !== items.size - 1) return false;
  return Math.max(...plan.placements.map((placement) => placement.page)) === plan.pageCount! - 1;
}

export function isSheetPlanForRequest(
  value: unknown,
  input: SheetPlanInput,
  definition: SheetDefinition,
  options: SheetOptions,
): value is SheetPlan {
  if (!isSheetPlan(value) || !Number.isSafeInteger(options.firstSlot) || options.firstSlot < 0) return false;
  const expectedSlots = definition.kind === 'explicit' ? definition.slots : expandGridSlots(definition);
  if (
    options.firstSlot >= expectedSlots.length ||
    value.placements.length !== input.itemCount ||
    value.layout.id !== definition.id ||
    value.layout.paperWidthUm !== definition.paperWidthUm ||
    value.layout.paperHeightUm !== definition.paperHeightUm ||
    value.layout.slots.length !== expectedSlots.length ||
    value.layout.slots.some((slot, index) => !sameSlot(slot, expectedSlots[index]))
  )
    return false;
  const expectedPages = Math.ceil((options.firstSlot + input.itemCount) / expectedSlots.length);
  if (value.pageCount !== expectedPages) return false;
  return value.placements.every((placement, item) => {
    const absolute = options.firstSlot + item;
    return (
      placement.item === item &&
      placement.page === Math.floor(absolute / expectedSlots.length) &&
      placement.slot === absolute % expectedSlots.length
    );
  });
}

function isSheetSlot(value: unknown): value is SheetSlot {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Partial<SheetSlot>;
  return (
    [slot.xUm, slot.yUm, slot.widthUm, slot.heightUm].every(Number.isSafeInteger) &&
    slot.xUm! >= 0 &&
    slot.yUm! >= 0 &&
    slot.widthUm! > 0 &&
    slot.heightUm! > 0
  );
}

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const isNonNegativeFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function expandGridSlots(grid: SheetGridDefinition): SheetSlot[] {
  const slots: SheetSlot[] = [];
  const append = (row: number, column: number) =>
    slots.push({
      xUm: grid.marginLeftUm + column * (grid.labelWidthUm + grid.gapXUm),
      yUm: grid.marginTopUm + row * (grid.labelHeightUm + grid.gapYUm),
      widthUm: grid.labelWidthUm,
      heightUm: grid.labelHeightUm,
    });
  if (grid.fillOrder === 'row-major') {
    for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) append(row, column);
  } else {
    for (let column = 0; column < grid.columns; column++) for (let row = 0; row < grid.rows; row++) append(row, column);
  }
  return slots;
}

const sameSlot = (left: SheetSlot, right: SheetSlot) =>
  left.xUm === right.xUm &&
  left.yUm === right.yUm &&
  left.widthUm === right.widthUm &&
  left.heightUm === right.heightUm;
