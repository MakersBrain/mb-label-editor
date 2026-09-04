// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { assertGroupInvariants, defaultDocument, moveElements, type LabelElement } from '../src/index.js';

/** 50 groups of 10 rectangles each: the shape that made per-command ancestry scans quadratic. */
function largeDocument() {
  const document = defaultDocument('2026-01-01T00:00:00Z');
  const elements: LabelElement[] = [];
  for (let group = 0; group < 50; group++) {
    const childIds: string[] = [];
    for (let child = 0; child < 10; child++) {
      const id = `g${group}c${child}`;
      childIds.push(id);
      elements.push({
        id,
        name: id,
        type: 'rectangle',
        transform: { x: group, y: child, width: 2, height: 2, rotation: 0 },
        zIndex: elements.length,
        visible: true,
        locked: false,
        strokeWidth: 0.2,
        filled: false,
        groupId: `g${group}`,
      });
    }
    elements.push({
      id: `g${group}`,
      name: `g${group}`,
      type: 'group',
      transform: { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
      zIndex: elements.length,
      visible: true,
      locked: false,
      childIds,
    });
  }
  document.elements = elements;
  assertGroupInvariants(document);
  return document;
}

describe('command cost on large documents', () => {
  it('moves elements in a 500-element document within a few milliseconds', () => {
    let document = largeDocument();
    const ids = ['g0', 'g1', 'g2c3'];
    const run = () => {
      const started = performance.now();
      document = moveElements(ids, { x: 0.1, y: 0 }).apply(document);
      return performance.now() - started;
    };
    for (let warm = 0; warm < 5; warm++) run();
    const samples = Array.from({ length: 20 }, run).sort((a, b) => a - b);
    const median = samples[10];
    // CI runners are slower and noisier than a workstation; the intent is "milliseconds, not tens of them".
    expect(median).toBeLessThan(process.env.CI ? 15 : 5);
    expect(document.elements.find((item) => item.id === 'g0c0')?.transform.x).toBeCloseTo(0 + 0.1 * 25, 6);
  });
});
