// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Point } from './model.js';

/** Asset being dragged out of the asset browser; the canvas resolves the drop into a label position. */
export interface AssetDrag { label: string; place: (at: Point) => Promise<void> | void }
class AssetDragState {
  current: AssetDrag | undefined = $state.raw(undefined);
}
export const assetDrag = new AssetDragState();
export const ASSET_DRAG_TYPE = 'application/x-mb-asset';
