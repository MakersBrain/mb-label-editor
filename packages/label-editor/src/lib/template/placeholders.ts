// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from '../model.js';

/** Field names referenced by `{{field | transform}}` expressions, in first-seen order; `@date` is built in. */
export function placeholderFields(sources: Iterable<string>): string[] {
  const fields: string[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(/\{\{([^}]*)\}\}/g)) {
      const field = match[1].split('|')[0].trim();
      if (field && !field.startsWith('@') && !fields.includes(field)) fields.push(field);
    }
  }
  return fields;
}

/** Every field the label's text, barcode and QR elements already expect from a record. */
export function documentFields(document: LabelDocument): string[] {
  return placeholderFields(
    document.elements.flatMap((element) =>
      element.type === 'text'
        ? [element.text]
        : element.type === 'barcode' || element.type === 'qr'
          ? [element.value]
          : [],
    ),
  );
}

/** A small catalogue-style CSV for trying the data features without a file at hand. */
export const SAMPLE_CSV = `name,price,sku
Strawberry jam,4.50,JAM-001
Earl Grey tea,3.00,TEA-014
Wildflower honey,6.25,HON-003
`;
