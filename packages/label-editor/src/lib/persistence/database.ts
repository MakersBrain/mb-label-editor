// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument, Resource, TemplateData } from '../model.js';
import type { SheetPreferencesV1 } from '../sheets/types.js';

const DB_NAME = 'makersbrain-label-editor'; const DB_VERSION = 1;
export type StoreName = 'documents' | 'autosaves' | 'templates' | 'assets' | 'recent' | 'preferences' | 'jobs';
export interface PersistedJob { id: string; documentId: string; createdAt: string; state: string; route: string; resumable: boolean; details?: unknown }
export interface RecentItem { id:string; kind:'document'|'template'|'asset'; openedAt:string }
export interface EditorPreferences { gridSize:number; showGrid:boolean; showRulers:boolean; snapping:boolean; defaultPrinterId?:string; defaultRoute?:string; theme:'system'|'light'|'dark'; sheet?:SheetPreferencesV1 }
const stores: StoreName[] = ['documents', 'autosaves', 'templates', 'assets', 'recent', 'preferences', 'jobs'];
export class EditorDatabase {
  #database?: Promise<IDBDatabase>;
  private open() { return this.#database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { for (const name of stores) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); }
  async put<T>(store: StoreName, key: IDBValidKey, value: T) { const db = await this.open(); const transaction = db.transaction(store, 'readwrite'); const done = transactionComplete(transaction); const request = requestResult(transaction.objectStore(store).put(structuredClone(value), key)); await Promise.all([request, done]); }
  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> { const db = await this.open(); const transaction = db.transaction(store); const done = transactionComplete(transaction); const request = requestResult(transaction.objectStore(store).get(key)); const [value] = await Promise.all([request, done]); return value as T | undefined; }
  async delete(store: StoreName, key: IDBValidKey) { const db = await this.open(); const transaction = db.transaction(store, 'readwrite'); const done = transactionComplete(transaction); const request = requestResult(transaction.objectStore(store).delete(key)); await Promise.all([request, done]); }
  async entries<T>(store: StoreName): Promise<{ key: IDBValidKey; value: T }[]> { const db = await this.open(); const transaction = db.transaction(store); const done = transactionComplete(transaction); const objectStore = transaction.objectStore(store); /* Queue both requests before yielding, while the transaction is active. */ const keysRequest = requestResult(objectStore.getAllKeys()); const valuesRequest = requestResult(objectStore.getAll()) as Promise<T[]>; const [keys, values] = await Promise.all([keysRequest, valuesRequest, done]); return keys.map((key, index) => ({ key, value: values[index] })); }
  saveDocument(document: LabelDocument) { return this.put('documents', document.id, document); }
  async listDocuments() { return (await this.entries<LabelDocument>('documents')).map(entry=>entry.value).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)); }
  async removeDocument(id:string) { await this.delete('documents',id); await this.delete('autosaves',id); }
  autosave(document: LabelDocument) { return this.put('autosaves', document.id, { document, savedAt: new Date().toISOString() }); }
  async latestAutosave() {
    const entries = await this.entries<{ document: LabelDocument; savedAt: string }>('autosaves');
    return entries.map((entry) => entry.value).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  }
  saveTemplate(id: string, template: TemplateData) { return this.put('templates', id, template); }
  saveAsset(asset: Resource) { return this.put('assets', asset.sha256, asset); }
  saveJob(job: PersistedJob) { return this.put('jobs', job.id, job); }
  saveRecent(item:RecentItem) { return this.put('recent',`${item.kind}:${item.id}`,item); }
  async listRecent(limit=20) { return (await this.entries<RecentItem>('recent')).map(entry=>entry.value).sort((a,b)=>b.openedAt.localeCompare(a.openedAt)).slice(0,limit); }
  savePreferences(preferences:EditorPreferences) { return this.put('preferences','editor',preferences); }
  getPreferences() { return this.get<EditorPreferences>('preferences','editor'); }
}
const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const transactionComplete = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  transaction.onerror = () => { /* onabort carries the final transaction error */ };
});

export interface Autosaver {
  (document: LabelDocument): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}
export function createAutosaver(database: EditorDatabase, intervalMs = 1500, onError: (error: unknown) => void = () => {}) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pending: LabelDocument | undefined;
  let inFlight = Promise.resolve();
  let disposed = false;
  const queue = () => {
    const document = pending;
    pending = undefined;
    if (!document) return inFlight;
    inFlight = inFlight.catch(() => {}).then(() => database.autosave(document));
    return inFlight;
  };
  const autosaver = ((document: LabelDocument) => {
    if (disposed) return;
    pending = structuredClone(document);
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => { timeout = undefined; void queue().catch(onError); }, intervalMs);
  }) as Autosaver;
  autosaver.flush = async () => {
    if (timeout) { clearTimeout(timeout); timeout = undefined; }
    await queue();
  };
  autosaver.dispose = async () => {
    disposed = true;
    try { await autosaver.flush(); } catch (error) { onError(error); }
  };
  return autosaver;
}
