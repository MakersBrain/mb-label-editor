// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { documentFields, placeholderFields } from '../src/lib/template/placeholders.js';
import { defaultDocument } from '../src/lib/model.js';

describe('placeholderFields', () => {
  it('collects unique field names in order and ignores transforms and built-ins', () => {
    expect(placeholderFields(['{{name | upper}} {{price|number:2}}', '{{@date}} {{ name }}', 'plain'])).toEqual([
      'name',
      'price',
    ]);
  });
  it('reads the text, barcode and qr elements of a document', () => {
    const document = defaultDocument();
    document.elements = [
      { ...document.elements[0], id: 't', type: 'text', text: '{{name}}' } as never,
      { ...document.elements[0], id: 'b', type: 'barcode', value: '{{sku}}' } as never,
      { ...document.elements[0], id: 'r', type: 'rectangle' } as never,
    ];
    expect(documentFields(document)).toEqual(['name', 'sku']);
  });
});
