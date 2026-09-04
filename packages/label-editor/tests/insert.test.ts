// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { insertPlacement, type LabelElement } from '../src/index.js';

const shape = (id: string, x: number, y: number, type: 'rectangle' | 'ellipse' = 'rectangle'): LabelElement => ({
  id,
  name: id,
  type,
  transform: { x, y, width: 12, height: 12, rotation: 0 },
  zIndex: 0,
  visible: true,
  locked: false,
  strokeWidth: 0.2,
  filled: false,
});
const area = { x: 0, y: 0, width: 50, height: 30 };
const size = { width: 12, height: 12 };

describe('insert placement', () => {
  it('centres a new element in the visible area', () => {
    expect(insertPlacement([], 'rectangle', size, area, 1)).toEqual({ x: 19, y: 9 });
  });
  it('cascades by one grid step only past elements of the same kind', () => {
    expect(insertPlacement([shape('a', 19, 9)], 'rectangle', size, area, 1)).toEqual({ x: 20, y: 10 });
    expect(insertPlacement([shape('a', 19, 9), shape('b', 20, 10)], 'rectangle', size, area, 2)).toEqual({
      x: 21,
      y: 11,
    });
    expect(insertPlacement([shape('a', 19, 9, 'ellipse')], 'rectangle', size, area, 1)).toEqual({ x: 19, y: 9 });
  });
  it('wraps to the top-left when the cascade would leave the area and clamps to it', () => {
    const crowded = [
      shape('a', 19, 9),
      ...Array.from({ length: 20 }, (_, index) => shape(`c${index}`, 19 + index + 1, 9 + index + 1)),
    ];
    const placed = insertPlacement(crowded, 'rectangle', size, area, 1);
    expect(placed.x + size.width).toBeLessThanOrEqual(area.width);
    expect(placed.y + size.height).toBeLessThanOrEqual(area.height);
    expect(insertPlacement([], 'rectangle', { width: 80, height: 80 }, area, 1)).toEqual({ x: 0, y: 0 });
  });
});
