// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import fixtureJson from './fixtures/sdk-v4-text.mb-label.json';
import { defaultDocument, fromSdkDocument, toSdkDocument, type SdkDocument } from '../src/index.js';
describe('mb-printer-sdk v4 compatibility', () => {
  it('reads canonical micrometres and writes them without geometry drift', () => {
    const fixture = fixtureJson as unknown as SdkDocument;
    const editor = fromSdkDocument(fixture);
    expect(editor.media).toMatchObject({ width: 63.5, height: 33.9, unit: 'mm' });
    expect(editor.elements[0].transform).toMatchObject({ x: 1.25, y: 2.5, width: 30, height: 8, rotation: 15 });
    const encoded = toSdkDocument(editor);
    expect(encoded.media).toEqual(fixture.media);
    expect(encoded.elements[0].transform).toEqual(fixture.elements[0].transform);
    expect(encoded.coordinateSystem).toEqual(fixture.coordinateSystem);
    expect(encoded.extensions['fixture:source']).toBe('mb-printer-sdk');
  });
});
describe('image rendering metadata', () => {
  it('round-trips non-destructive image inversion and emits the SDK render extension', () => {
    const document = defaultDocument('2026-01-01T00:00:00Z');
    document.resources = [{ id: 'photo', name: 'photo.png', mimeType: 'image/png', sha256: 'hash', data: 'AA==' }];
    document.elements = [
      {
        id: 'picture',
        name: 'Picture',
        type: 'image',
        resourceId: 'photo',
        fit: 'contain',
        invert: true,
        dither: { algorithm: 'atkinson', threshold: 128 },
        transform: { x: 0, y: 0, width: 20, height: 20, rotation: 0 },
        zIndex: 0,
        visible: true,
        locked: false,
      },
    ];
    const encoded = toSdkDocument(document);
    expect(encoded.extensions['makersbrain.render:images']).toEqual({ picture: { invert: true } });
    const decoded = fromSdkDocument(encoded);
    expect(decoded.elements[0]).toMatchObject({ id: 'picture', type: 'image', invert: true });
    expect(decoded.extensions).toBeUndefined();
  });
});

it('preserves external canonical fonts, fields, and render policy without editor metadata', () => {
  const fixture = structuredClone(fixtureJson) as unknown as SdkDocument;
  fixture.resources = [
    { id: 'font', mediaType: 'font/ttf', sha256: 'hash', dataBase64: 'AA==' },
    { id: 'photo', mediaType: 'image/png', sha256: 'photo-hash', dataBase64: 'AA==' },
  ];
  fixture.elements[0].fontResource = 'font';
  fixture.elements.push({
    type: 'image',
    id: 'picture',
    transform: { x: 32000, y: 2500, width: 10000, height: 10000, rotationMillidegrees: 0 },
    zOrder: 1,
    visible: true,
    locked: false,
    groupId: null,
    constraints: { preserveAspect: true, zone: 'right' },
    resource: 'photo',
    crop: null,
  });
  fixture.media.zones = [
    { id: 'left', bounds: { x: 0, y: 0, width: 30000, height: 33900 }, cloneOf: null },
    { id: 'right', bounds: { x: 33500, y: 0, width: 30000, height: 33900 }, cloneOf: 'left' },
  ];
  fixture.fields = [{ key: 'name', label: 'Customer name' }];
  fixture.extensions = {
    'makersbrain.render:dither': { algorithm: 'bayer', threshold: 117, futureMode: 'preserve-me-too' },
    'makersbrain.render:images': { picture: { invert: true, futureMode: 'preserve-me' } },
    'fixture:source': { producer: 'sdk', revision: 4 },
  };
  const decoded = fromSdkDocument(fixture);
  expect(decoded.elements[0]).toMatchObject({ type: 'text', fontResourceId: 'font' });
  expect(decoded.elements[1]).toMatchObject({
    type: 'image',
    resourceId: 'photo',
    invert: true,
    dither: { algorithm: 'bayer', threshold: 117 },
    constraints: [{ kind: 'aspect' }, { kind: 'zone', value: 'right' }],
  });
  expect(decoded.media.zones).toEqual([
    { id: 'left', name: 'left', x: 0, y: 0, width: 30, height: 33.9 },
    { id: 'right', name: 'right', x: 33.5, y: 0, width: 30, height: 33.9, cloneOf: 'left' },
  ]);
  expect(decoded.template).toMatchObject({ fields: ['name'], fieldLabels: { name: 'Customer name' }, records: [] });
  expect(decoded.extensions).toEqual(fixture.extensions);
  const encoded = toSdkDocument(decoded);
  expect(encoded.elements[0].fontResource).toBe('font');
  expect(encoded.fields).toEqual(fixture.fields);
  expect(encoded.media.zones).toEqual(fixture.media.zones);
  expect(encoded.elements[1].constraints).toEqual(fixture.elements[1].constraints);
  expect(encoded.extensions['makersbrain.render:dither']).toEqual({
    algorithm: 'bayer',
    threshold: 117,
    futureMode: 'preserve-me-too',
  });
  expect(encoded.extensions['makersbrain.render:images']).toEqual({
    picture: { invert: true, futureMode: 'preserve-me' },
  });
  expect(encoded.extensions['fixture:source']).toEqual({ producer: 'sdk', revision: 4 });
  if (decoded.elements[1].type !== 'image') throw new Error('expected image');
  decoded.elements[1].invert = false;
  expect(toSdkDocument(decoded).extensions['makersbrain.render:images']).toEqual({
    picture: { futureMode: 'preserve-me' },
  });
});

it('ignores malformed editor-private metadata without losing canonical extensions', () => {
  const fixture = structuredClone(fixtureJson) as unknown as SdkDocument;
  fixture.extensions = { 'makersbrain.editor:state': null, 'fixture:source': 'external' };
  expect(() => fromSdkDocument(fixture)).not.toThrow();
  const encoded = toSdkDocument(fromSdkDocument(fixture));
  expect(encoded.extensions['fixture:source']).toBe('external');
});

it('carries a QR quiet zone only when it is set', () => {
  const editor = defaultDocument();
  const base = {
    name: 'QR',
    transform: { x: 1, y: 1, width: 10, height: 10, rotation: 0 },
    zIndex: 0,
    visible: true,
    locked: false,
  };
  editor.elements = [
    { ...base, id: 'q1', type: 'qr', value: 'x', errorCorrection: 'M' } as never,
    { ...base, id: 'q2', type: 'qr', value: 'y', errorCorrection: 'L', quietZone: 1 } as never,
  ];
  const sdk = toSdkDocument(editor) as unknown as { elements: Record<string, unknown>[] };
  expect(sdk.elements[0]).not.toHaveProperty('quietZone');
  expect(sdk.elements[1]).toMatchObject({ type: 'qr-code', quietZone: 1 });
  const back = fromSdkDocument(sdk as unknown as SdkDocument);
  expect(back.elements[0]).not.toHaveProperty('quietZone');
  expect(back.elements[1]).toMatchObject({ type: 'qr', quietZone: 1 });
});
