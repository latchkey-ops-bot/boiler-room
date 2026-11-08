import { describe, expect, it } from 'vitest';
import {
  arrive,
  arriveN,
  depart,
  rack,
  specFrame,
  springPop,
  typeDrift,
  wordRise,
} from '../src/core/curves.ts';
import { decodingUrl, holdStart, typedLength } from '../src/scenes/end-card.tsx';
import { appearsAt, lineStart, slamBlurred, slamScale } from '../src/scenes/word-slam.tsx';

describe('the spec curves', () => {
  it('arrive at peak speed, and arriveN settles exactly on its frame', () => {
    expect(arrive(1, 0.72)).toBeCloseTo(0.28, 10);
    expect(arriveN(0, 0.72, 14)).toBe(0);
    expect(arriveN(14, 0.72, 14)).toBe(1);
    expect(arriveN(13, 0.72, 14)).toBeLessThan(1);
    // Each step is the measured one, scaled by 1 / (1 - k ** D): within 1% for arrive.fast.
    expect(arriveN(1, 0.72, 14) / arrive(1, 0.72)).toBeCloseTo(1 / (1 - 0.72 ** 14), 10);
  });

  it('depart from rest and end at peak speed', () => {
    expect(depart(0, 11, 1.4)).toBe(0);
    expect(depart(11, 11, 1.4)).toBe(1);
    const steps = [1, 2, 3].map((f) => depart(f, 11, 1.4) - depart(f - 1, 11, 1.4));
    expect(steps[1] as number).toBeCloseTo((steps[0] as number) * 1.4, 10);
  });

  it('rise words one frame apart, popping in at full opacity 72 px low', () => {
    expect(wordRise(0, 0)).toEqual({ visible: true, y: 72 });
    expect(wordRise(0, 1)).toEqual({ visible: false, y: 72 });
    expect(wordRise(14, 1).y).toBeLessThan(2);
  });

  it('drift type 0.13% a frame', () => {
    expect(typeDrift(10)).toBeCloseTo(1.013, 10);
  });

  it('pop a node to 0.794 on its first frame and peak at 1.066 three frames later', () => {
    expect(springPop(0)).toBeCloseTo(0.794, 2);
    expect(springPop(3)).toBeCloseTo(1.066, 2);
    expect(Math.abs(springPop(8) - 1)).toBeLessThan(0.01);
  });

  it('rack into focus over four frames', () => {
    expect([0, 1, 2, 3, 4].map((f) => rack(f))).toEqual([
      { blur: 6, y: 13 },
      { blur: 3, y: 7 },
      { blur: 1.2, y: 4 },
      { blur: 0, y: 1 },
      { blur: 0, y: 0 },
    ]);
  });

  it('count spec frames at 30 fps, so a decay keeps its speed in seconds at 24', () => {
    expect(specFrame(17, 30)).toBe(17);
    expect(specFrame(24, 24)).toBe(30);
    expect(0.75 ** specFrame(24, 24)).toBeCloseTo((0.75 ** (30 / 24)) ** 24, 10);
  });
});

describe('word-slam', () => {
  const rest = 0.37;

  it('slams in at 5.4 and is 8.6% over rest on frame 9', () => {
    expect(slamScale(0, rest)).toBeCloseTo(5.4, 10);
    expect(slamScale(9, rest)).toBeCloseTo(1.086, 3);
  });

  it('collapses to sentence size by frame 22, never growing on the way', () => {
    const scales = Array.from({ length: 14 }, (_, index) => slamScale(9 + index, rest));
    expect(scales).toEqual([...scales].sort((a, b) => b - a));
    expect(slamScale(22, rest)).toBe(rest);
    expect(slamScale(40, rest)).toBe(rest);
  });

  it('blurs on frames 0 to 2 of the slam and is sharp from 3 to 9', () => {
    expect([0, 1, 2].map((f) => slamBlurred(f, rest))).toEqual([true, true, true]);
    expect([3, 4, 5, 6, 7, 8, 9].some((f) => slamBlurred(f, rest))).toBe(false);
    expect(slamBlurred(30, rest)).toBe(false);
  });

  it('appends the second word on frame 23 and each word after it 3 frames later', () => {
    expect([0, 1, 2, 3].map(appearsAt)).toEqual([0, 23, 26, 29]);
  });

  it('re-centres a line as words join it, and settles centred', () => {
    const line = { widths: [100, 60, 80], first: 0 };
    const space = 20;
    expect(lineStart(22, line, space, 960)).toBe(960 - 50);
    expect(lineStart(23, line, space, 960)).toBe(960 - 50);
    expect(lineStart(200, line, space, 960)).toBeCloseTo(960 - (100 + 60 + 80 + 40) / 2, 10);
  });
});

describe('end-card', () => {
  it('decodes the URL from its last letter, keeping everything that is not a letter', () => {
    const url = 'nova.example.com';
    expect(decodingUrl(url, 0)).toBe('qryd.hadpsoh.frp');
    expect(decodingUrl('xyz', 0)).toBe('abc');
    expect(decodingUrl('XYZ', 0)).toBe('ABC');
    expect(decodingUrl(url, 6).endsWith('.frm')).toBe(true);
    expect(decodingUrl(url, 6 + url.length - 1)).toBe(url);
  });

  it('types a URL 18 characters every 40 frames', () => {
    expect(typedLength('nova.example.com', 6)).toBe(0);
    expect(typedLength('nova.example.com', 46)).toBe(16);
    expect(typedLength('nova.example.com', 26)).toBe(9);
  });

  it('holds still for the last 69 frames, 2.3 s at any rate', () => {
    expect(holdStart(180, 30)).toBe(111);
    expect(holdStart(96, 24)).toBe(96 - 55);
  });
});
