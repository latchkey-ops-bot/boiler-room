import { describe, expect, it } from 'vitest';
import { resolveLogo } from '../src/brand/logo.ts';
import { analysePixels } from '../src/brand/probe.ts';

const SIZE = 48;
type Rgba = [number, number, number, number];

/** A square image: `background` everywhere, and `ink` in the rectangle from `from` to `to`. */
function image(background: Rgba, ink: Rgba, from = 12, to = 36): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inside = x >= from && x < to && y >= from && y < to;
      data.set(inside ? ink : background, (y * SIZE + x) * 4);
    }
  }
  return data;
}

const WHITE: Rgba = [255, 255, 255, 255];
const NAVY: Rgba = [0x1f, 0x3a, 0x93, 255];
const CLEAR: Rgba = [0, 0, 0, 0];
const inkShare = (24 * 24) / (SIZE * SIZE);

describe('analysePixels', () => {
  it('reads a logo on a transparent background as all ink', () => {
    const seen = analysePixels(image(CLEAR, NAVY), SIZE);
    expect(seen.plate).toBeUndefined();
    expect(seen.coverage).toBeCloseTo(inkShare);
    expect(seen.palette).toEqual([{ color: '#223399', share: 1 }]);
  });

  it('takes an opaque box of one colour as the plate the mark sits on, not as ink', () => {
    const seen = analysePixels(image(WHITE, NAVY), SIZE);
    expect(seen.plate).toBe('#FFFFFF');
    expect(seen.coverage).toBeCloseTo(inkShare);
    expect(seen.palette).toEqual([{ color: '#223399', share: 1 }]);
  });

  it('does not take a mark that runs off its edges in several colours for a plate', () => {
    const data = image(WHITE, NAVY);
    for (let x = 0; x < SIZE / 2; x += 1) data.set(NAVY, x * 4);
    for (let y = 0; y < SIZE / 2; y += 1) data.set(NAVY, y * SIZE * 4);
    expect(analysePixels(data, SIZE).plate).toBeUndefined();
  });
});

describe('a logo on a plate', () => {
  const boxed = analysePixels(image(WHITE, NAVY), SIZE);
  const probe = { loaded: true, width: 600, height: 200, animated: false, ...boxed };

  it('is kept on a white brand, where its box was read as faint ink and rejected', () => {
    expect(resolveLogo(probe, 'logo.png', '#FFFFFF')).toEqual({
      kind: 'image',
      src: 'logo.png',
      aspect: 3,
      plate: '#FFFFFF',
    });
  });

  it('is drawn on its plate on a dark brand, judged against the plate it sits on', () => {
    expect(resolveLogo(probe, 'logo.png', '#0E1420')).toEqual({
      kind: 'image',
      src: 'logo.png',
      aspect: 3,
      plate: '#FFFFFF',
    });
  });

  it('is rejected when its mark cannot be seen on its own plate', () => {
    const faint = analysePixels(image(WHITE, [0xe0, 0xe0, 0xe0, 255]), SIZE);
    expect(resolveLogo({ ...probe, ...faint }, 'logo.png', '#0E1420')).toEqual({
      kind: 'wordmark',
      reason: 'invisible',
    });
  });
});
