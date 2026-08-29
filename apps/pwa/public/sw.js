// SPDX-License-Identifier: AGPL-3.0-or-later
const CACHE='mb-label-editor-v3';const ROOT=new URL('./',self.location.href);const SHELL=[ROOT.href,new URL('manifest.webmanifest',ROOT).href,new URL('icons/icon.svg',ROOT).href];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const update=()=>fetch(event.request).then(response=>{if(response.ok&&new URL(event.request.url).origin===self.location.origin){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response});event.respondWith(event.request.mode==='navigate'?update().catch(()=>caches.match(ROOT.href)):caches.match(event.request).then(hit=>hit??update()))});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
