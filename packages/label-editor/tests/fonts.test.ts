// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FONT_GROUPS, faceMetrics, fontStack, genericFor, pickFace } from '../src/lib/fonts.js';

describe('font menu', () => {
  it('lists the expected families in four groups', () => {
    expect(FONT_GROUPS.map((group) => group.label)).toEqual(['Sans-Serif', 'Serif', 'Monospace', 'Display']);
    expect(FONT_GROUPS.flatMap((group) => group.families.map((item) => item.name))).toEqual([
      'Inter',
      'Roboto',
      'Open Sans',
      'Lato',
      'Montserrat',
      'Oswald',
      'Arial',
      'Helvetica',
      'Playfair Display',
      'Merriweather',
      'Georgia',
      'Times New Roman',
      'Roboto Mono',
      'Source Code Pro',
      'Courier New',
      'Impact',
      'Comic Sans MS',
    ]);
  });
  it('falls back to the right generic family', () => {
    expect(genericFor('Georgia')).toBe('serif');
    expect(genericFor('Roboto Mono')).toBe('monospace');
    expect(genericFor('Comic Sans MS')).toBe('cursive');
    expect(genericFor('IBM Plex Sans')).toBe('sans-serif');
    expect(genericFor('IBM Plex Mono')).toBe('monospace');
    expect(fontStack('Times New Roman')).toBe('"Times New Roman",serif');
    expect(fontStack('sans-serif')).toBe('sans-serif');
  });
  it('reads weight and slant from a face style name', () => {
    expect(faceMetrics('Regular')).toEqual({ weight: 400, style: 'normal' });
    expect(faceMetrics('Bold Italic')).toEqual({ weight: 700, style: 'italic' });
    expect(faceMetrics('SemiBold')).toEqual({ weight: 600, style: 'normal' });
    expect(faceMetrics('ExtraLight Oblique')).toEqual({ weight: 200, style: 'italic' });
  });
  it('picks the upright face nearest the wanted weight', () => {
    const face = (style: string) => ({
      postscriptName: style,
      fullName: style,
      family: 'X',
      style,
      blob: async () => new Blob(),
    });
    const faces = [face('Bold Italic'), face('Bold'), face('Italic'), face('Regular'), face('Light')];
    expect(pickFace(faces).style).toBe('Regular');
    expect(pickFace(faces, 700).style).toBe('Bold');
    expect(pickFace(faces, 400, 'italic').style).toBe('Italic');
    expect(pickFace(faces, 600).style).toBe('Bold');
  });
});
