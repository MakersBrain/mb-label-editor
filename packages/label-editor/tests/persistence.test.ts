// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  createAutosaver,
  defaultDocument,
  EditorDatabase,
  parseDocument,
  parseDocumentStrict,
  serializeDocument,
  toSdkDocument,
} from '../src/index.js';
describe('local persistence', () => {
  it('round-trips v4 files', () => {
    const doc = defaultDocument('2026-01-01T00:00:00Z');
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
    expect(() => parseDocument('{"version":3}')).toThrow(/v4/);
  });
  it('stores documents in IndexedDB', async () => {
    const database = new EditorDatabase();
    const doc = defaultDocument();
    await database.saveDocument(doc);
    expect(await database.get('documents', doc.id)).toEqual(doc);
  });
  it('selects the newest autosave for crash recovery', async () => {
    const database = new EditorDatabase();
    const older = defaultDocument('2026-01-01T00:00:00Z');
    older.title = 'older';
    const newer = defaultDocument('2026-01-02T00:00:00Z');
    newer.title = 'newer';
    await database.put('autosaves', older.id, { document: older, savedAt: '2026-01-01T00:00:00Z' });
    await database.put('autosaves', newer.id, { document: newer, savedAt: '2026-01-02T00:00:00Z' });
    expect((await database.latestAutosave())?.document.title).toBe('newer');
  });
});
describe('strict document opening', () => {
  it('passes the untouched canonical value to the authoritative validator', async () => {
    const raw = { ...toSdkDocument(defaultDocument()), unknownField: true };
    const validateCanonical = vi.fn(async (value: unknown) => ({
      valid: !(value as Record<string, unknown>).unknownField,
      errors: ['unknown field unknownField'],
    }));
    await expect(parseDocumentStrict(JSON.stringify(raw), { validateCanonical })).rejects.toThrow(/unknown field/);
    expect(validateCanonical).toHaveBeenCalledWith(raw);
  });
  it('routes v3 through the SDK importer before validation', async () => {
    const canonical = toSdkDocument(defaultDocument());
    const importV3Canonical = vi.fn(async () => canonical);
    const validateCanonical = vi.fn(async () => ({ valid: true, errors: [] }));
    await expect(parseDocumentStrict('{"version":3}', { validateCanonical, importV3Canonical })).resolves.toMatchObject(
      { version: 4 },
    );
    expect(importV3Canonical).toHaveBeenCalled();
    expect(validateCanonical).toHaveBeenCalledWith(canonical);
  });
});
describe('persistence lifecycle', () => {
  it('returns keys and values from requests queued in one active transaction', async () => {
    const database = new EditorDatabase();
    const first = defaultDocument('2026-01-01T00:00:00Z');
    const second = defaultDocument('2026-01-02T00:00:00Z');
    await database.put('documents', 'first', first);
    await database.put('documents', 'second', second);
    const entries = await database.entries<typeof first>('documents');
    expect(entries.find((item) => item.key === 'first')?.value).toEqual(first);
    expect(entries.find((item) => item.key === 'second')?.value).toEqual(second);
  });
  it('flushes only the latest pending autosave and ignores schedules after disposal', async () => {
    const database = new EditorDatabase();
    const autosaver = createAutosaver(database, 60_000);
    const first = defaultDocument('2026-01-01T00:00:00Z');
    const latest = { ...first, title: 'latest' };
    autosaver(first);
    autosaver(latest);
    await autosaver.flush();
    expect((await database.get<{ document: typeof first }>('autosaves', first.id))?.document.title).toBe('latest');
    await autosaver.dispose();
    const ignored = { ...first, title: 'ignored' };
    autosaver(ignored);
    await autosaver.flush();
    expect((await database.get<{ document: typeof first }>('autosaves', first.id))?.document.title).toBe('latest');
  });
  it('saves at the maximum wait even while changes keep arriving, then again once they settle', async () => {
    vi.useFakeTimers();
    try {
      const autosave = vi.fn().mockResolvedValue(undefined);
      const autosaver = createAutosaver({ autosave } as unknown as EditorDatabase, 1500, () => {}, 5000);
      const base = defaultDocument();
      for (let step = 0; step < 16; step++) {
        autosaver({ ...base, title: `edit ${step}` });
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(autosave).toHaveBeenCalledTimes(1);
      expect(autosave.mock.calls[0][0].title).toBe('edit 9');
      await vi.advanceTimersByTimeAsync(1500);
      expect(autosave).toHaveBeenCalledTimes(2);
      expect(autosave.mock.calls[1][0].title).toBe('edit 15');
      await autosaver.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it('reports timer-triggered autosave failures and continues with a later save', async () => {
    vi.useFakeTimers();
    try {
      const autosave = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined);
      const errors: unknown[] = [];
      const autosaver = createAutosaver({ autosave } as unknown as EditorDatabase, 10, (error) => errors.push(error));
      autosaver(defaultDocument());
      await vi.advanceTimersByTimeAsync(10);
      expect(errors).toHaveLength(1);
      autosaver(defaultDocument());
      await vi.advanceTimersByTimeAsync(10);
      expect(autosave).toHaveBeenCalledTimes(2);
      await autosaver.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
