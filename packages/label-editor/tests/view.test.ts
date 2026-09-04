// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fitToView,
  labelToScreen,
  PX_PER_MM,
  screenToLabel,
  visibleLabelArea,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../src/index.js';

const media = { width: 50, height: 30 };

describe('fit to view', () => {
  it('fits the label inside the padded area and centres it beside the rulers', () => {
    const fit = fitToView(media, { width: 500, height: 400 }, { paddingPx: 40, rulerInset: 20 });
    const width = media.width * PX_PER_MM * fit.zoom;
    const height = media.height * PX_PER_MM * fit.zoom;
    expect(width).toBeLessThanOrEqual(500 - 20 - 80);
    expect(height).toBeLessThanOrEqual(400 - 20 - 80);
    expect(Math.max(width / (500 - 100), height / (400 - 100))).toBeCloseTo(1, 6);
    expect(fit.pan).toEqual({ x: 10, y: 10 });
  });
  it('clamps to the zoom range at both ends', () => {
    expect(fitToView(media, { width: 80, height: 60 }).zoom).toBe(ZOOM_MIN);
    expect(fitToView(media, { width: 9000, height: 9000 }).zoom).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('label and screen coordinates', () => {
  const view = { zoom: 2, pan: { x: 10, y: -4 }, viewport: { width: 800, height: 600 } };
  it('round-trip through the pan and zoom transform', () => {
    const point = { x: 12.5, y: 7.25 };
    const screen = labelToScreen(point, view, media);
    expect(screenToLabel(screen, view, media).x).toBeCloseTo(point.x, 9);
    expect(screenToLabel(screen, view, media).y).toBeCloseTo(point.y, 9);
    expect(labelToScreen({ x: media.width / 2, y: media.height / 2 }, view, media)).toEqual({ x: 410, y: 296 });
  });
  it('reports the visible label area and falls back to the whole label', () => {
    const zoomedIn = { zoom: 4, pan: { x: 0, y: 0 }, viewport: { width: 300, height: 200 } };
    const area = visibleLabelArea(zoomedIn, media);
    expect(area.width).toBeLessThan(media.width);
    expect(area.x + area.width / 2).toBeCloseTo(media.width / 2, 6);
    expect(visibleLabelArea({ ...zoomedIn, viewport: { width: 0, height: 0 } }, media)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 30,
    });
    expect(visibleLabelArea({ zoom: 1, pan: { x: 5000, y: 0 }, viewport: { width: 300, height: 200 } }, media)).toEqual(
      { x: 0, y: 0, width: 50, height: 30 },
    );
  });
});
