// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from '../model.js';
import type { LaPosteFormat, LaPosteSlot, PrinterSdk, PrintRequest, PrintResult, PrintRoute } from '../print/types.js';
import { LA_POSTE_FORMATS } from '../print/types.js';

export interface LaPosteInspection {
  format: LaPosteFormat;
  source: Uint8Array;
  slots: LaPosteSlot[];
  selected: Set<string>;
}
export async function inspectLaPosteSheet(
  sdk: PrinterSdk,
  source: Uint8Array,
  format: LaPosteFormat,
  options?: { pages?: number[]; dpi?: number },
): Promise<LaPosteInspection> {
  if (!LA_POSTE_FORMATS.includes(format)) throw new Error(`Unknown La Poste format: ${format}`);
  const canonical = format === 'SHEET' ? 'L24A_SHEET' : format;
  const slots = await sdk.inspectLaPoste(source, canonical, options);
  const occupied = slots.filter((slot) => slot.occupied);
  if (!occupied.length) throw new Error('The selected pages contain no occupied postage marks.');
  for (const slot of occupied)
    if (slot.widthMm !== 63.5 || slot.heightMm !== 33.9)
      throw new Error('SDK returned a postage mark with invalid physical dimensions.');
  return { format: canonical, source, slots, selected: new Set(occupied.map((slot) => slot.id)) };
}
export const selectLaPosteSlots = (inspection: LaPosteInspection, ids: Iterable<string>): LaPosteInspection => ({
  ...inspection,
  selected: new Set([...ids].filter((id) => inspection.slots.some((slot) => slot.id === id && slot.occupied))),
});
export async function selectedDocuments(sdk: PrinterSdk, inspection: LaPosteInspection): Promise<LabelDocument[]> {
  const slots = inspection.slots
    .filter((slot) => inspection.selected.has(slot.id))
    .sort((a, b) => a.sourcePage - b.sourcePage || a.slot - b.slot);
  if (!slots.length) throw new Error('Select at least one postage mark.');
  return await Promise.all(slots.map((slot) => sdk.laPosteSlotDocument(inspection.source, inspection.format, slot)));
}
export async function exportLaPostePdf(sdk: PrinterSdk, inspection: LaPosteInspection) {
  return await sdk.exportPdf(await selectedDocuments(sdk, inspection));
}
export async function printLaPoste(
  sdk: PrinterSdk,
  inspection: LaPosteInspection,
  route: PrintRoute,
  request: Omit<PrintRequest, 'document'>,
): Promise<PrintResult[]> {
  const results: PrintResult[] = [];
  for (const document of await selectedDocuments(sdk, inspection)) {
    const result = await route.print({ ...request, document });
    results.push(result);
    if (result.outcome !== 'completed') break;
  }
  return results;
}
