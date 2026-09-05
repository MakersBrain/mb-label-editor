// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import corpus from '../../../../mb-printer-sdk/fixtures/template/corpus.json';
import { evaluateTemplate, mapCsvFields, parseCsv } from '../src/index.js';
describe('shared SDK template parity', () => {
  it('parses quoted CSV and explicit field maps', () => {
    const parsed = parseCsv('source,city\n"Doe, Jane",Paris\n');
    expect(parsed).toEqual({ fields: ['source', 'city'], records: [{ source: 'Doe, Jane', city: 'Paris' }] });
    expect(mapCsvFields(parsed.records, { name: 'source', place: 'city' })).toEqual([
      { name: 'Doe, Jane', place: 'Paris' },
    ]);
  });
  it.each(corpus.cases)('$name matches the canonical SDK corpus', (entry) => {
    const run = () =>
      evaluateTemplate(entry.template, {
        record: entry.fields as Record<string, string>,
        locale: entry.locale,
        currentDate: entry.date,
      });
    if ('error' in entry) expect(run).toThrow(entry.error);
    else expect(run()).toBe(entry.output);
  });
  it('rejects transforms outside the allowlist', () => {
    expect(() => evaluateTemplate('{{name|eval}}', { record: { name: 'Ada' } })).toThrow('unknown transform: eval');
  });
  it('decimals:N keeps only the digits a value needs', () => {
    const run = (value: string, locale = 'en') =>
      evaluateTemplate('{{v|decimals:2}}', { record: { v: value }, locale });
    expect(run('30.0')).toBe('30');
    expect(run('30')).toBe('30');
    expect(run('4.5')).toBe('4.5');
    expect(run('4.50')).toBe('4.5');
    expect(run('4.256')).toBe('4.26');
    expect(run('-0.001')).toBe('0');
    expect(run('2.675', 'fr-FR')).toBe('2,68');
    expect(() => run('abc')).toThrow();
  });
});
