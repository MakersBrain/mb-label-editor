// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument } from './model.js'; import {fromSdkDocument,toSdkDocument} from './sdk-document.js';
import { ContinuousMediaError, continuousSettings, isResolvedLabelDocument } from './continuous-media.js';

interface FileSystemFileHandle { getFile(): Promise<File>; createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }> }
interface PickerWindow extends Window {
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
}
export const serializeDocument = (document: LabelDocument) => {
  if(document.media.shape==='continuous'&&continuousSettings(document).lengthMode==='fit-content'&&!isResolvedLabelDocument(document))throw new ContinuousMediaError('continuous.unresolved_document','Fit-content continuous labels must be prepared before serialization.');
  return JSON.stringify(toSdkDocument(document), null, 2) + '\n';
};
export function parseDocument(text: string): LabelDocument { return fromSdkDocument(JSON.parse(text) as unknown); }
export interface CanonicalDocumentValidator {
  validateCanonical(value: unknown): Promise<{ valid: boolean; errors: string[] }>;
  importV3Canonical?(value: unknown): Promise<unknown>;
}
export async function parseDocumentStrict(text: string, validator: CanonicalDocumentValidator): Promise<LabelDocument> {
  let canonical = JSON.parse(text) as unknown;
  if (canonical && typeof canonical === 'object' && (canonical as { version?: unknown }).version === 3) {
    if (!validator.importV3Canonical) throw new Error('Canonical v3 import is unavailable.');
    canonical = await validator.importV3Canonical(canonical);
  }
  const result = await validator.validateCanonical(canonical);
  if (!result.valid) throw new Error(`Document validation failed: ${result.errors.join('; ')}`);
  return fromSdkDocument(canonical);
}
/** The File System Access API rejects an extension containing anything but letters, digits, `+` and `.`, so the picker filters on `.json` even though labels are saved as `.mb-label.json`. */
export const labelFileTypes = [{ description: 'MakersBrain label', accept: { 'application/json': ['.json'] } }];
export async function openDocument(file: File | undefined, validator: CanonicalDocumentValidator): Promise<{ document: LabelDocument; handle?: FileSystemFileHandle }> {
  let handle: FileSystemFileHandle | undefined;
  if (!file && typeof window !== 'undefined' && (window as PickerWindow).showOpenFilePicker) [handle] = await (window as PickerWindow).showOpenFilePicker!({ types: labelFileTypes, multiple: false });
  const selected = file ?? await handle?.getFile(); if (!selected) throw new Error('No file selected');
  return { document: await parseDocumentStrict(await selected.text(), validator), handle };
}
export async function saveDocument(document: LabelDocument, suggestedName = `${document.title}.mb-label.json`, existing?: FileSystemFileHandle) {
  const contents = serializeDocument(document); let handle = existing;
  if (!handle && typeof window !== 'undefined' && (window as PickerWindow).showSaveFilePicker) handle = await (window as PickerWindow).showSaveFilePicker!({ suggestedName, types: labelFileTypes });
  if (handle) { const writable = await handle.createWritable(); await writable.write(contents); await writable.close(); return handle; }
  const anchor = documentRoot().createElement('a'); anchor.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' })); anchor.download = suggestedName; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 0); return undefined;
}
const documentRoot = () => { if (typeof document === 'undefined') throw new Error('Downloads require a browser'); return document; };
export async function sha256(data: ArrayBuffer) { const digest = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
