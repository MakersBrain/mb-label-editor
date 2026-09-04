// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from 'svelte';
import App from './App.svelte';
import './theme.css';
mount(App, { target: document.getElementById('app')! });
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD || import.meta.env.MODE === 'test')
    window.addEventListener(
      'load',
      () =>
        void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
          registration.addEventListener('updatefound', () => {
            if (registration.active) window.dispatchEvent(new Event('mb-pwa-update'));
          });
        }),
    );
  else
    window.addEventListener(
      'load',
      () =>
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
          .then(() => caches.delete('mb-label-editor-v2')),
    );
}
