// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from './model.js'; import {fromSdkDocument,toSdkDocument} from './sdk-document.js';

interface FileSystemFileHandle { getFile(): Promise<File>; createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }> }
interface PickerWindow extends Window {
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
}
export const serializeDocument = (document: LabelDocument) => JSON.stringify(toSdkDocument(document), null, 2) + '\n';
export function parseDocument(text: string): LabelDocument { return fromSdkDocument(JSON.parse(text) as unknown); }
export async function openDocument(file?: File): Promise<{ document: LabelDocument; handle?: FileSystemFileHandle }> {
  let handle: FileSystemFileHandle | undefined;
  if (!file && typeof window !== 'undefined' && (window as PickerWindow).showOpenFilePicker) [handle] = await (window as PickerWindow).showOpenFilePicker!({ types: [{ description: 'MakersBrain label', accept: { 'application/json': ['.mb-label.json'] } }], multiple: false });
  const selected = file ?? await handle?.getFile(); if (!selected) throw new Error('No file selected');
  return { document: parseDocument(await selected.text()), handle };
}
export async function saveDocument(document: LabelDocument, suggestedName = `${document.title}.mb-label.json`, existing?: FileSystemFileHandle) {
  const contents = serializeDocument(document); let handle = existing;
  if (!handle && typeof window !== 'undefined' && (window as PickerWindow).showSaveFilePicker) handle = await (window as PickerWindow).showSaveFilePicker!({ suggestedName, types: [{ description: 'MakersBrain label', accept: { 'application/json': ['.mb-label.json'] } }] });
  if (handle) { const writable = await handle.createWritable(); await writable.write(contents); await writable.close(); return handle; }
  const anchor = documentRoot().createElement('a'); anchor.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' })); anchor.download = suggestedName; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 0); return undefined;
}
const documentRoot = () => { if (typeof document === 'undefined') throw new Error('Downloads require a browser'); return document; };
export async function sha256(data: ArrayBuffer) { const digest = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
