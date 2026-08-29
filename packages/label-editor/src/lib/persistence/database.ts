// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelDocument, Resource, TemplateData } from '../model.js';

const DB_NAME = 'makersbrain-label-editor'; const DB_VERSION = 1;
export type StoreName = 'documents' | 'autosaves' | 'templates' | 'assets' | 'recent' | 'preferences' | 'jobs';
export interface PersistedJob { id: string; documentId: string; createdAt: string; state: string; route: string; resumable: boolean; details?: unknown }
export interface RecentItem { id:string; kind:'document'|'template'|'asset'; openedAt:string }
export interface EditorPreferences { gridSize:number; showGrid:boolean; showRulers:boolean; snapping:boolean; defaultPrinterId?:string; defaultRoute?:string; theme:'system'|'light'|'dark' }
const stores: StoreName[] = ['documents', 'autosaves', 'templates', 'assets', 'recent', 'preferences', 'jobs'];
export class EditorDatabase {
  #database?: Promise<IDBDatabase>;
  private open() { return this.#database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { for (const name of stores) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); }
  async put<T>(store: StoreName, key: IDBValidKey, value: T) { const db = await this.open(); await transactionPromise(db.transaction(store, 'readwrite').objectStore(store).put(structuredClone(value), key)); }
  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> { const db = await this.open(); return await transactionPromise(db.transaction(store).objectStore(store).get(key)) as T | undefined; }
  async delete(store: StoreName, key: IDBValidKey) { const db = await this.open(); await transactionPromise(db.transaction(store, 'readwrite').objectStore(store).delete(key)); }
  async entries<T>(store: StoreName): Promise<{ key: IDBValidKey; value: T }[]> { const db = await this.open(); const transaction = db.transaction(store); const objectStore = transaction.objectStore(store); const keys = await transactionPromise(objectStore.getAllKeys()); const values = await transactionPromise(objectStore.getAll()) as T[]; return keys.map((key, index) => ({ key, value: values[index] })); }
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
const transactionPromise = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

export function createAutosaver(database: EditorDatabase, intervalMs = 1500) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (document: LabelDocument) => { if (timeout) clearTimeout(timeout); timeout = setTimeout(() => { void database.autosave(document); }, intervalMs); };
}
