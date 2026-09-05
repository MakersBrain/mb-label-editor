// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { TemplateData } from '../src/lib/model.js';
import { allFieldNames, resolveRecord, resolvedRecords, validateDerivedField } from '../src/lib/template/derived.js';
import { defaultDocument } from '../src/lib/model.js';
import { materializeRecord } from '../src/lib/template/materialize.js';

const template: TemplateData = {
  fields: ['name', 'price'],
  records: [
    { name: 'Jam', price: '4.5' },
    { name: 'Tea', price: '3' },
  ],
  currentRecord: 0,
  derived: [
    { name: 'price_short', expression: '{{price | number:0}} €' },
    { name: 'line', expression: '{{name | upper}} · {{price_short}}' },
  ],
};

describe('derived fields', () => {
  it('resolves derived columns in order so later ones can use earlier ones', () => {
    expect(resolveRecord(template, template.records[0])).toEqual({
      name: 'Jam',
      price: '4.5',
      price_short: '5 €',
      line: 'JAM · 5 €',
    });
    expect(resolvedRecords(template).map((record) => record.line)).toEqual(['JAM · 5 €', 'TEA · 3 €']);
    expect(allFieldNames(template)).toEqual(['name', 'price', 'price_short', 'line']);
  });
  it('returns the raw record untouched when nothing is derived', () => {
    const record = { name: 'Jam' };
    expect(resolveRecord({ ...template, derived: [] }, record)).toBe(record);
  });
  it('throws on a broken formula unless lenient, which shows the error in the cell', () => {
    const broken: TemplateData = { ...template, derived: [{ name: 'x', expression: '{{missing}}' }] };
    expect(() => resolveRecord(broken, template.records[0])).toThrow('unknown field: missing');
    expect(resolveRecord(broken, template.records[0], { lenient: true }).x).toContain('unknown field: missing');
  });
  it('materialises elements with derived values', () => {
    const document = defaultDocument();
    document.template = template;
    document.elements = [{ ...document.elements[0], id: 't', type: 'text', text: '{{line}}' } as never];
    const result = materializeRecord(document, 1);
    expect((result.elements[0] as { text: string }).text).toBe('TEA · 3 €');
  });
  it('validates names and formulas', () => {
    expect(validateDerivedField(template, { name: 'price', expression: '{{price}}' })).toContain(
      'already a data column',
    );
    expect(validateDerivedField(template, { name: 'line', expression: '{{price}}' })).toContain(
      'already a derived column',
    );
    expect(validateDerivedField(template, { name: 'line', expression: '{{price}}' }, 'line')).toBeUndefined();
    expect(validateDerivedField(template, { name: '{{x}}', expression: '{{price}}' })).toContain('plain column name');
    expect(validateDerivedField(template, { name: 'total', expression: 'no fields' })).toContain('at least one');
    expect(validateDerivedField(template, { name: 'total', expression: '{{price}}' })).toBeUndefined();
  });
});
