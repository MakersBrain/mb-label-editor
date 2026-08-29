// SPDX-License-Identifier: AGPL-3.0-or-later
import { mount } from 'svelte'; import App from './App.svelte'; import './theme.css';
mount(App,{target:document.getElementById('app')!});
if('serviceWorker' in navigator) window.addEventListener('load',()=>void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`));
