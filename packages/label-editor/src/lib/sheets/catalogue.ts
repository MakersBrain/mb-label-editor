// SPDX-License-Identifier: AGPL-3.0-or-later
import layouts from '../../../assets/sheet-layouts.json';
import { isSheetLayoutPreset, type SheetLayoutPreset } from './types.js';

const presets: SheetLayoutPreset[] = layouts.map((layout, index) => {
  if (!isSheetLayoutPreset(layout)) throw new Error(`Invalid sheet layout preset at index ${index}.`);
  return layout;
});

export function sheetLayoutPresets(): SheetLayoutPreset[] {
  return structuredClone(presets);
}

export function sheetLayoutPreset(id: string): SheetLayoutPreset | undefined {
  return sheetLayoutPresets().find((preset) => preset.id === id);
}
