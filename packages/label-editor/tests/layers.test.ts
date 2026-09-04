// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultDocument, layerIcon, layerLabel, type LabelElement } from '../src/index.js';

const base = {
  transform: { x: 1, y: 1, width: 12, height: 7.5, rotation: 0 },
  zIndex: 0,
  visible: true,
  locked: false,
};

describe('layer labels', () => {
  const document = defaultDocument();
  document.resources = [{ id: 'r1', name: 'logo.png', mimeType: 'image/png', sha256: '', data: '' }];
  it('describe text, codes, artwork, groups and shapes without changing the stored name', () => {
    const text: LabelElement = {
      ...base,
      id: 't',
      name: 'Text',
      type: 'text',
      text: 'Blueberry jam  {{price}}',
      fontFamily: 'sans-serif',
      fontSize: 4,
      fontWeight: 400,
      horizontalAlign: 'left',
      verticalAlign: 'top',
      overflow: 'word-wrap',
    };
    expect(layerLabel(text, document)).toEqual({ name: 'Text', meta: 'Blueberry jam {{price}}' });
    expect(layerLabel({ ...text, text: 'Text' }, document)).toEqual({ name: 'Text' });
    expect(layerLabel({ ...text, text: 'x'.repeat(40) }, document).meta).toHaveLength(24);
    expect(
      layerLabel(
        { ...base, id: 'q', name: 'QR', type: 'qr', value: 'https://makersbrain.com', errorCorrection: 'M' },
        document,
      ).meta,
    ).toBe('https://makersbrain.com');
    expect(
      layerLabel({ ...base, id: 'i', name: 'Image', type: 'image', resourceId: 'r1', fit: 'contain' }, document).meta,
    ).toBe('logo.png');
    expect(layerLabel({ ...base, id: 'g', name: 'Group', type: 'group', childIds: ['a', 'b'] }, document).meta).toBe(
      '2 items',
    );
    expect(
      layerLabel({ ...base, id: 's', name: 'Rectangle', type: 'rectangle', strokeWidth: 0.2, filled: false }, document)
        .meta,
    ).toBe('12 × 7.5 mm');
  });
  it('maps every element type to an icon', () => {
    expect(layerIcon({ ...base, id: 's', name: 'Rectangle', type: 'rectangle', strokeWidth: 0.2, filled: false })).toBe(
      'rectangle',
    );
    expect(layerIcon({ ...base, id: 'g', name: 'Group', type: 'group', childIds: [] })).toBe('group');
  });
});
