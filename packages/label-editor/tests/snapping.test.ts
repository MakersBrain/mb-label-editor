// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { guidesEqual, snapMove, snapTargets, snapWithTargets, type LabelElement } from '../src/index.js';

const shape = (id: string, x: number): LabelElement => ({ id, name: id, type: 'rectangle', transform: { x, y: 1, width: 5, height: 5, rotation: 0 }, zIndex: 0, visible: true, locked: false, strokeWidth: 0.2, filled: false });
const media = { x: 0, y: 0, width: 50, height: 30 };

describe('precomputed snap targets', () => {
  it('reproduce snapMove for every mode from targets computed once', () => {
    const elements = [shape('moving', 1.2), shape('fixed', 10.3)];
    const selected = new Set(['moving']);
    const base = { grid: 2, gridEnabled: true, threshold: 0.25, guides: [{ axis: 'x' as const, value: 30.1 }] };
    const targets = snapTargets(elements, selected, media, base);
    for (const mode of ['all', 'grid', 'elements', 'none'] as const) {
      for (const delta of [{ x: 3.9, y: 0 }, { x: 24, y: 0.1 }, { x: -0.9, y: 2.2 }]) {
        expect(snapWithTargets(targets, delta, { ...base, mode })).toEqual(snapMove(elements, selected, delta, media, { ...base, mode }));
      }
    }
  });
  it('snaps a moving selection to a stationary edge and reports the guide', () => {
    const targets = snapTargets([shape('moving', 1), shape('fixed', 10)], new Set(['moving']), media, { guides: [] });
    const result = snapWithTargets(targets, { x: 3.8, y: 0.2 }, { grid: 1, gridEnabled: true, threshold: 0.5 });
    expect(result.delta).toEqual({ x: 4, y: 0 });
    expect(result.guides).toContainEqual({ axis: 'x', value: 10 });
  });
  it('compares guide lists by value', () => {
    expect(guidesEqual([], [])).toBe(true);
    expect(guidesEqual([{ axis: 'x', value: 1 }], [{ axis: 'x', value: 1 }])).toBe(true);
    expect(guidesEqual([{ axis: 'x', value: 1 }], [{ axis: 'y', value: 1 }])).toBe(false);
    expect(guidesEqual([{ axis: 'x', value: 1 }], [])).toBe(false);
  });
});
