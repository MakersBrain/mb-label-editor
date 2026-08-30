// SPDX-License-Identifier: AGPL-3.0-or-later
export const DOWNLOAD_URL_LIFETIME_MS = 60_000;
export const PDF_WINDOW_URL_LIFETIME_MS = 300_000;

export interface BrowserDownloadAnchor {
  href: string;
  download: string;
  click(): void;
}

export interface BrowserPdfWindow {
  opener: unknown;
  document: { title: string; body: { textContent: string | null } };
  location: { href: string };
  close(): void;
}

export interface BrowserFilePort {
  createDownloadAnchor(): BrowserDownloadAnchor;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  openWindow(): BrowserPdfWindow | null;
  schedule(callback: () => void, delayMs: number): unknown;
}

export interface DownloadBytesOptions {
  filename: string;
  mimeType: string;
  lifetimeMs?: number;
}

export interface OpenPdfOptions {
  title?: string;
  loadingMessage?: string;
  lifetimeMs?: number;
}

export function downloadBytes(
  data: Uint8Array,
  options: DownloadBytesOptions,
  port: BrowserFilePort = browserFilePort(),
): void {
  const anchor = port.createDownloadAnchor();
  const url = port.createObjectUrl(bytesBlob(data, options.mimeType));
  anchor.href = url;
  anchor.download = options.filename;
  try {
    anchor.click();
  } catch (error) {
    port.revokeObjectUrl(url);
    throw error;
  }
  scheduleRevoke(port, url, options.lifetimeMs ?? DOWNLOAD_URL_LIFETIME_MS);
}

export async function openPdfInNewWindow(
  load: () => Promise<Uint8Array>,
  options: OpenPdfOptions = {},
  port: BrowserFilePort = browserFilePort(),
): Promise<boolean> {
  const target = port.openWindow();
  if (!target) return false;

  let url: string | undefined;
  try {
    target.opener = null;
    target.document.title = options.title ?? 'Preparing PDF';
    target.document.body.textContent = options.loadingMessage ?? 'Preparing PDF…';
    const data = await load();
    url = port.createObjectUrl(bytesBlob(data, 'application/pdf'));
    target.location.href = url;
    scheduleRevoke(port, url, options.lifetimeMs ?? PDF_WINDOW_URL_LIFETIME_MS);
    return true;
  } catch (error) {
    if (url) port.revokeObjectUrl(url);
    try { target.close(); } catch { /* Closing a failed popup is best effort. */ }
    throw error;
  }
}

function bytesBlob(data: Uint8Array, mimeType: string): Blob {
  return new Blob([data.slice().buffer as ArrayBuffer], { type: mimeType });
}

function scheduleRevoke(port: BrowserFilePort, url: string, delayMs: number): void {
  try {
    port.schedule(() => port.revokeObjectUrl(url), delayMs);
  } catch {
    port.revokeObjectUrl(url);
  }
}

function browserFilePort(): BrowserFilePort {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('File downloads require a browser.');
  }
  return {
    createDownloadAnchor: () => document.createElement('a'),
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    openWindow: () => window.open('', '_blank'),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  };
}
