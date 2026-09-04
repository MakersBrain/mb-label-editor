// SPDX-License-Identifier: AGPL-3.0-or-later
import { writable } from 'svelte/store';
import type { Point } from './model.js';

/** Asset being dragged out of the asset browser; the canvas resolves the drop into a label position. */
export interface AssetDrag { label: string; place: (at: Point) => Promise<void> | void }
export const assetDrag = writable<AssetDrag | undefined>(undefined);
export const ASSET_DRAG_TYPE = 'application/x-mb-asset';
