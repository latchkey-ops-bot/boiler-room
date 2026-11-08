import type { Campaign } from '@boiler-room/schema';
import nova from '@boiler-room/schema/examples/nova.campaign.json' with { type: 'json' };
import quillhaven from '@boiler-room/schema/examples/quillhaven.campaign.json' with {
  type: 'json',
};
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/manifest.ts';
import { planQuality } from '../src/quality.ts';
import { composeSheet, createCanvas, GLYPHS, textWidth } from '../src/sheets.ts';

describe('planQuality', () => {
  it('takes one frame a second, on the frame each second starts', () => {
    const plan = planQuality(nova as Campaign);
    expect(plan.contact).toHaveLength(20);
    expect(plan.contact.slice(0, 3)).toEqual([
      { frame: 0, second: 0, scene: 'open' },
      { frame: 30, second: 1, scene: 'open' },
      { frame: 60, second: 2, scene: 'open' },
    ]);
    expect(plan.contact.at(-1)).toEqual({ frame: 570, second: 19, scene: 'close' });
  });

  it("takes a matched-velocity seam's stills 12 frames before it and 14 after, in spec frames", () => {
    const seam = planQuality(quillhaven as Campaign).transitions.find(({ name }) => name === 't1');
    // 24 fps: 12 spec frames are 10 film frames, and 14 are 11.
    expect(seam?.stills.map(({ frame }) => frame - (seam?.boundary ?? 0))).toEqual([-10, 0, 11]);
  });

  it('counts seconds at the campaign frame rate', () => {
    const plan = planQuality(quillhaven as Campaign);
    expect(plan.fps).toBe(24);
    expect(plan.contact.map(({ frame }) => frame)).toEqual(
      Array.from({ length: 18 }, (_, second) => second * 24),
    );
  });

  it('shows each transition the frame before its window, its boundary and the frame after', () => {
    const plan = planQuality(nova as Campaign);
    expect(plan.transitions.map(({ name, boundary }) => [name, boundary])).toEqual([
      ['t3', 120],
      ['t3', 270],
      ['t3', 420],
    ]);
    // A dead-stop cut: the last outgoing frame, the cut, and the word rise at rest 13 frames on.
    expect(plan.transitions[0]?.stills).toEqual([
      { when: 'before', frame: 119 },
      { when: 'during', frame: 120 },
      { when: 'after', frame: 133 },
    ]);
    for (const transition of plan.transitions) {
      const [before, during, after] = transition.stills.map(({ frame }) => frame) as number[];
      expect(before).toBeLessThan(transition.from);
      expect(during).toBeGreaterThanOrEqual(transition.from);
      expect(during).toBeLessThan(transition.to);
      expect(after).toBe(transition.to);
    }
  });

  it('shows each scene two thirds through, inside the scene', () => {
    const plan = planQuality(nova as Campaign);
    expect(plan.phone).toEqual([
      { scene: 'open', frame: 80 },
      { scene: 'speed', frame: 220 },
      { scene: 'adoption', frame: 370 },
      { scene: 'close', frame: 540 },
    ]);
  });
});

describe('composeSheet', () => {
  it('lays tiles out in rows, with room for a title and a label under each', () => {
    const tile = createCanvas(40, 20, [255, 0, 0]);
    const sheet = composeSheet(
      Array.from({ length: 5 }, (_, index) => ({ image: tile, label: `F${index}` })),
      { columns: 3, gap: 10, labelScale: 2, title: 'SHEET' },
    );
    expect(sheet.width).toBe(3 * 40 + 4 * 10);
    // Title band, then two rows of a tile and its label, with gaps between.
    expect(sheet.height).toBe(14 + 10 + 2 * (20 + 14 + 10) + 3 * 10);
    // The first tile's top left pixel is red.
    const offset = ((14 + 10 + 10) * sheet.width + 10) * 4;
    expect([...sheet.data.subarray(offset, offset + 3)]).toEqual([255, 0, 0]);
  });

  it('measures text in the 5 × 7 font with one column between letters', () => {
    expect(textWidth('F120', 2)).toBe((4 * 6 - 1) * 2);
    expect(textWidth('', 2)).toBe(0);
  });

  it('has a 5 × 7 glyph for every letter, digit and mark a label uses', () => {
    for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-/ ') {
      expect(GLYPHS[character], character).toMatch(/^[01]{35}$/);
    }
  });

  it('refuses an empty sheet', () => {
    expect(() => composeSheet([], { columns: 3 })).toThrow(RangeError);
  });
});

describe('canonicalJson', () => {
  it('writes equal objects the same way whatever order their keys are in', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { e: 3, f: 2 }] }, b: 1 }),
    );
    expect(canonicalJson({ a: undefined, b: 'x' })).toBe('{"b":"x"}');
  });
});
