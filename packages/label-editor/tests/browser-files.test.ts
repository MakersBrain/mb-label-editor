// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_URL_LIFETIME_MS,
  PDF_WINDOW_URL_LIFETIME_MS,
  downloadBytes,
  openPdfInNewWindow,
  type BrowserDownloadAnchor,
  type BrowserFilePort,
  type BrowserPdfWindow,
} from '../src/lib/browser-files.js';

function fixture(options: { blocked?: boolean; clickError?: Error; navigationError?: Error } = {}) {
  const revoked: string[] = [];
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const blobs: Blob[] = [];
  const click = vi.fn(() => { if (options.clickError) throw options.clickError; });
  const anchor: BrowserDownloadAnchor = { href: '', download: '', click };
  const close = vi.fn();
  const location = {
    _href: '',
    get href() { return this._href; },
    set href(value: string) {
      if (options.navigationError) throw options.navigationError;
      this._href = value;
    },
  };
  const popup: BrowserPdfWindow = {
    opener: {},
    document: { title: '', body: { textContent: null } },
    location,
    close,
  };
  const port: BrowserFilePort = {
    createDownloadAnchor: () => anchor,
    createObjectUrl: (blob) => { blobs.push(blob); return `blob:test-${blobs.length}`; },
    revokeObjectUrl: (url) => revoked.push(url),
    openWindow: () => options.blocked ? null : popup,
    schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }),
  };
  return { port, anchor, click, popup, close, blobs, revoked, scheduled };
}

describe('browser file handoff', () => {
  it('retains a download URL until the delayed browser-consumption window ends', async () => {
    const test = fixture();
    downloadBytes(new Uint8Array([1, 2]), { filename: 'label.pdf', mimeType: 'application/pdf' }, test.port);
    expect(test.anchor).toMatchObject({ href: 'blob:test-1', download: 'label.pdf' });
    expect(test.click).toHaveBeenCalledOnce();
    expect(test.blobs[0]).toMatchObject({ size: 2, type: 'application/pdf' });
    expect(test.revoked).toEqual([]);
    expect(test.scheduled[0]?.delayMs).toBe(DOWNLOAD_URL_LIFETIME_MS);
    test.scheduled[0]?.callback();
    expect(test.revoked).toEqual(['blob:test-1']);
  });

  it('revokes immediately when the browser rejects the download click', () => {
    const test = fixture({ clickError: new Error('click failed') });
    expect(() => downloadBytes(new Uint8Array(), { filename: 'label.png', mimeType: 'image/png' }, test.port)).toThrow('click failed');
    expect(test.revoked).toEqual(['blob:test-1']);
    expect(test.scheduled).toEqual([]);
  });

  it('does not build a PDF or allocate a URL when the popup is blocked', async () => {
    const test = fixture({ blocked: true });
    const load = vi.fn(async () => new Uint8Array([1]));
    await expect(openPdfInNewWindow(load, {}, test.port)).resolves.toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(test.blobs).toEqual([]);
    expect(test.revoked).toEqual([]);
  });

  it('keeps an opened PDF alive for the viewer and closes cleanly on navigation failure', async () => {
    const success = fixture();
    await expect(openPdfInNewWindow(async () => new Uint8Array([1]), { title: 'Sheet' }, success.port)).resolves.toBe(true);
    expect(success.popup).toMatchObject({ opener: null, document: { title: 'Sheet' }, location: { href: 'blob:test-1' } });
    expect(success.revoked).toEqual([]);
    expect(success.scheduled[0]?.delayMs).toBe(PDF_WINDOW_URL_LIFETIME_MS);
    success.scheduled[0]?.callback();
    expect(success.revoked).toEqual(['blob:test-1']);

    const failed = fixture({ navigationError: new Error('navigation failed') });
    await expect(openPdfInNewWindow(async () => new Uint8Array([1]), {}, failed.port)).rejects.toThrow('navigation failed');
    expect(failed.revoked).toEqual(['blob:test-1']);
    expect(failed.close).toHaveBeenCalledOnce();
    expect(failed.scheduled).toEqual([]);
  });
});

describe('font import', () => {
  const file = (bytes: number[], name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });
  const ttf = [0x00, 0x01, 0x00, 0x00];
  it('accepts a face a catalogue served as application/octet-stream', async () => {
    const { importFont } = await import('../src/lib/imports.js');
    const imported = await importFont(file(ttf, 'Inter-Regular.ttf', 'application/octet-stream'));
    expect(imported).toMatchObject({ mimeType: 'font/ttf', family: 'Inter-Regular', weight: 400 });
  });
  it('recognises a face by its signature when neither the type nor the name says so', async () => {
    const { fontMimeType, importFont } = await import('../src/lib/imports.js');
    expect(fontMimeType(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]), 'download', '')).toBe('font/otf');
    expect(fontMimeType(new Uint8Array([0x77, 0x4f, 0x46, 0x46]), 'download', '')).toBe('font/woff');
    expect(fontMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'download', '')).toBeUndefined();
    await expect(importFont(file([0x89, 0x50, 0x4e, 0x47], 'logo', 'application/octet-stream'))).rejects.toThrow(/Unsupported font type/);
  });
});
