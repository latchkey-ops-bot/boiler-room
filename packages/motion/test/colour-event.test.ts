import {
  type Campaign,
  contrastRatio,
  FORMATS,
  readableOn,
  sceneFrames,
} from '@boiler-room/schema';
import novaPayoff from '@boiler-room/schema/examples/nova-payoff.campaign.json' with {
  type: 'json',
};
import quillhavenPayoff from '@boiler-room/schema/examples/quillhaven-payoff.campaign.json' with {
  type: 'json',
};
import { describe, expect, it } from 'vitest';
import { skinOf } from '../src/brand/skin.ts';
import type { SpecFit } from '../src/components/type.tsx';
import { specFrame, typeDrift } from '../src/core/curves.ts';
import { filmSeams } from '../src/film/seams.ts';
import { validateFilm } from '../src/film/validate-film.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { FORMAT_SIZES, stageFor } from '../src/layout/stage.ts';
import {
  cardBox,
  cardOf,
  cardRise,
  colourEvent,
  eventInk,
  eventLayout,
  frostedRect,
  headlineFitError,
  headlineWidth,
  sentenceSize,
  slamScale,
} from '../src/scenes/colour-event.tsx';
import { anchorVelocities, groundOf } from '../src/scenes/definition.ts';
import { definitionOf } from '../src/scenes/registry.ts';
import { at } from './fixtures.ts';

const payoffs = {
  'nova-payoff': () => structuredClone(novaPayoff) as Campaign,
  'quillhaven-payoff': () => structuredClone(quillhavenPayoff) as Campaign,
};

const stages = FORMATS.map((format) => {
  const { width, height } = FORMAT_SIZES[format];
  return [format, stageFor(width, height)] as const;
});

const landscape = stageFor(1920, 1080);

/** A fitted line as `specFit` returns it, for a face whose cap height is 0.7 of its size. */
const fitOf = (overrides: Partial<SpecFit> = {}): SpecFit => ({
  fontSize: 300,
  lines: ['Ship it.'],
  height: 330,
  width: 900,
  fontFamily: 'Display',
  weight: 700,
  lineHeight: 1.1,
  letterSpacing: '-0.01em',
  metrics: { cap: 0.7, ascent: 0.95, descent: 0.25 },
  targetSize: 301,
  ...overrides,
});

const definition = () => {
  const found = definitionOf('colour-event');
  if (!found) throw new Error('colour-event is not registered');
  return found;
};

describe('colour-event registry entry', () => {
  it('is a type scene on the event ground in both skins, with a card anchor and no velocity', () => {
    const entry = definition();
    expect(entry.kind).toBe('type');
    expect(groundOf(entry, {}, 'neutral-cut')).toBe('event');
    expect(groundOf(entry, {}, 'kinetic-plate')).toBe('event');
    expect(groundOf(entry, { card: 'frosted' }, 'neutral-cut')).toBe('event');
    expect(anchorVelocities(entry, {})).toEqual([
      { id: 'card', entry: undefined, exit: undefined },
    ]);
    expect(entry.roles).toEqual({ headline: { min: 1, max: 1 } });
    expect(entry.image).toBe('none');
    expect(entry.holdFrom).toBeUndefined();
  });

  it("takes card: 'simple' or 'frosted', simple by default, and no accent at all", () => {
    const { props } = definition();
    expect(cardOf(props.parse({}) as { card?: 'simple' | 'frosted' })).toBe('simple');
    expect(props.safeParse({ card: 'frosted' }).success).toBe(true);
    expect(props.safeParse({ card: 'glass' }).success).toBe(false);
    expect(props.safeParse({ accent: { textId: 'payoff-line', from: 0, to: 1 } }).success).toBe(
      false,
    );
  });

  it('refuses an accent phrase in a campaign, as the accent is the ground here', () => {
    const campaign = payoffs['nova-payoff']();
    at(campaign.scenes, 3).props = { accent: { textId: 'payoff-line', from: 0, to: 1 } };
    expect(validateFilm(campaign, '16:9')).toEqual([
      expect.objectContaining({ code: 'PROPS_INVALID', path: 'scenes[3].props' }),
    ]);
  });
});

describe('colour-event motion', () => {
  it('raises the card 60 px into place on arrive.snap, at rest from frame 8', () => {
    expect(cardRise(0, landscape)).toBe(60);
    for (let f = 1; f < 8; f += 1) {
      expect(cardRise(f, landscape)).toBeLessThan(cardRise(f - 1, landscape));
      expect(cardRise(f, landscape)).toBeGreaterThan(0);
    }
    expect(cardRise(8, landscape)).toBe(0);
    expect(cardRise(30, landscape)).toBe(0);
    // Half the travel is left after the first frame, as arrive.snap's k of 0.5 gives.
    expect(cardRise(1, landscape)).toBeCloseTo((60 * (0.5 - 0.5 ** 8)) / (1 - 0.5 ** 8), 10);
  });

  it('slams the headline from 1.26 by 0.3 a frame, and never below its rest', () => {
    expect(slamScale(0)).toBeCloseTo(1.26, 10);
    expect(slamScale(1)).toBeCloseTo(1.078, 10);
    expect(slamScale(2)).toBeCloseTo(1 + 0.26 * 0.09, 10);
    expect(slamScale(5)).toBeLessThan(1.001);
    expect(slamScale(6)).toBe(1);
    expect(slamScale(8)).toBe(1);
    for (let f = 0; f < 40; f += 0.25) {
      expect(slamScale(f)).toBeGreaterThanOrEqual(1);
      expect(slamScale(f + 0.25)).toBeLessThanOrEqual(slamScale(f));
    }
  });

  it('keeps every frame of a 24 fps film on the same curve in seconds', () => {
    // Frame 6 at 24 fps is 7.5 spec frames: the card is nearly at rest, and at rest by frame 7.
    expect(cardRise(specFrame(6, 24), landscape)).toBeGreaterThan(0);
    expect(cardRise(specFrame(7, 24), landscape)).toBe(0);
    expect(slamScale(specFrame(5, 24))).toBe(1);
  });

  it('drifts the card box larger about the frame centre on every frame', () => {
    const fit = fitOf();
    const layout = eventLayout(fit, landscape, 'frosted');
    const rest = frostedRect(landscape);
    expect(layout.card).toEqual(rest);
    const at8 = cardBox(layout, landscape, 8);
    expect(at8.width).toBeCloseTo(rest.width * typeDrift(8), 10);
    expect(at8.x + at8.width / 2).toBeCloseTo(960, 10);
    expect(at8.y + at8.height / 2).toBeCloseTo(540, 10);
    // On frame 0 it is 60 px below its rest.
    const at0 = cardBox(layout, landscape, 0);
    expect(at0.y + at0.height / 2).toBeCloseTo(600, 10);
    // It never stops growing, so the last frame of a 42-frame scene is still moving.
    expect(cardBox(layout, landscape, 41).width).toBeGreaterThan(
      cardBox(layout, landscape, 40).width,
    );
    // A T1 entry has no rise of its own.
    expect(cardBox(layout, landscape, 0, true).y + at0.height / 2).toBeCloseTo(540, 10);
  });
});

describe.each(stages)('colour-event layout in %s', (format, stage) => {
  const { width: W, height: H } = stage;

  it('sizes the frosted card as the scene file gives it, centred', () => {
    const shares = { '16:9': [0.5, 0.36], '9:16': [0.86, 0.3], '1:1': [0.76, 0.4] }[format];
    const [width = 0, height = 0] = shares;
    const card = frostedRect(stage);
    expect(card.width).toBeCloseTo(W * width, 10);
    expect(card.height).toBeCloseTo(H * height, 10);
    expect(card.x + card.width / 2).toBeCloseTo(W / 2, 10);
    expect(card.y + card.height / 2).toBeCloseTo(H / 2, 10);
  });

  it('fits a simple headline to 0.60 or 0.70 of the width, and 9:16 inside its slam', () => {
    const share = { '16:9': 0.6, '9:16': 0.8, '1:1': 0.7 }[format];
    const width = headlineWidth(stage, 'simple');
    if (format === '9:16') {
      // A 0.80 W headline at the slam's 1.26 on frame 0 would be wider than the frame.
      expect(W * share * 1.26).toBeGreaterThan(W);
      expect(width).toBeCloseTo(stage.safe.width / 1.26, 10);
    } else {
      expect(width).toBeCloseTo(W * share, 10);
    }
    // On frame 0 the slammed headline stays inside the safe area, in every format.
    expect(width * slamScale(0)).toBeLessThanOrEqual(stage.safe.width + 1e-9);
  });

  it('keeps a frosted headline inside its card, so one ink reads on all of it', () => {
    const width = headlineWidth(stage, 'frosted');
    const card = frostedRect(stage);
    expect(width).toBeLessThanOrEqual(card.width - 2 * colourEvent.frostedInset * W + 1e-9);
    // Only 16:9 needs this: its 0.60 W headline box is wider than its 0.50 W card.
    if (format === '16:9') expect(width).toBeCloseTo(0.44 * W, 10);
    else expect(width).toBe(headlineWidth(stage, 'simple'));
  });

  it("centres the headline's cap height on the frame", () => {
    const fit = fitOf();
    const layout = eventLayout(fit, stage, 'simple');
    const { ascent, descent } = fit.metrics;
    const baseline =
      layout.lineTop + ((fit.lineHeight - ascent - descent) / 2 + ascent) * fit.fontSize;
    const capTop = baseline - fit.metrics.cap * fit.fontSize;
    expect((capTop + baseline) / 2).toBeCloseTo(H / 2, 10);
    expect(layout.slamOrigin).toEqual({ x: W / 2, y: H / 2 });
    // A simple card is the headline itself.
    expect(layout.card).toEqual(layout.headline);
    expect(layout.headline.x + layout.headline.width / 2).toBeCloseTo(W / 2, 10);
  });

  it('sets a headline at any size from the sentence cap height up, and fails below it', () => {
    const width = headlineWidth(stage, 'simple');
    const floor = Math.floor(sentenceSize(fitOf(), stage));
    expect(floor).toBe(111);
    expect(headlineFitError('Ship it.', fitOf({ fontSize: 301 }), stage, width)).toBeUndefined();
    expect(headlineFitError('Ship it.', fitOf({ fontSize: floor }), stage, width)).toBeUndefined();
    const small = headlineFitError('Ship it.', fitOf({ fontSize: floor - 1 }), stage, width);
    expect(small).toContain('does not fit on one line');
    expect(small).toContain(`${W}×${H}`);
    const split = headlineFitError('Ship it.', fitOf({ lines: ['Ship', 'it.'] }), stage, width);
    expect(split).toContain('does not fit on one line');
    expect(headlineFitError('', fitOf({ lines: [], fontSize: 0 }), stage, width)).toContain(
      '0 words',
    );
  });
});

describe('colour-event ink', () => {
  const primaries = [
    '#7C9CFF',
    '#8C2F1B',
    '#000000',
    '#FFFFFF',
    '#777777',
    '#767676',
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFB86B',
    '#2F5D50',
    '#5A5AF0',
  ];

  it('sets simple type in black or white, whichever reads on the primary', () => {
    for (const primary of primaries) {
      const { behind, ink, veil } = eventInk(primary, 'simple');
      expect(behind).toBe(primary);
      expect(veil).toBeUndefined();
      expect(ink).toBe(readableOn(primary));
      expect(contrastRatio(ink, behind)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('frosts a dark primary with white, a light one with black, and reads on the result', () => {
    expect(eventInk('#8C2F1B', 'frosted').veil).toBe('#FFFFFF');
    expect(eventInk('#7C9CFF', 'frosted').veil).toBe('#000000');
    for (const primary of primaries) {
      const { behind, ink } = eventInk(primary, 'frosted');
      expect(contrastRatio(ink, behind)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('reads the frosted card as the veil at 18% over the primary', () => {
    // #8C2F1B under white at 18%: each channel 18% of the way to 255.
    expect(eventInk('#8C2F1B', 'frosted').behind).toBe('#A15444');
  });
});

describe.each(Object.entries(payoffs))('the %s example', (_name, copy) => {
  it('passes the render gate and validateFilm in every format', async () => {
    const campaign = copy();
    expect(await validateForRender(campaign)).toEqual({ ok: true, issues: [], campaign });
    for (const format of campaign.variants.formats) {
      expect(validateFilm(campaign, format)).toEqual([]);
    }
  });

  it('enters and leaves the colour event on T3, as written', () => {
    const seams = filmSeams(copy());
    const into = seams.find(({ to }) => to === 'payoff');
    const out = seams.find(({ from }) => from === 'payoff');
    expect(into).toMatchObject({ used: 't3', reason: 'written' });
    expect(out).toMatchObject({ used: 't3', reason: 'written' });
  });

  it('is the one full-bleed stretch: past 60% of the film, and 69 frames or fewer', () => {
    const campaign = copy();
    const frames = sceneFrames(campaign);
    const events = campaign.scenes
      .map((scene, index) => ({ scene, frames: at(frames.scenes, index) }))
      .filter(({ scene }) => scene.type === 'colour-event');
    expect(events).toHaveLength(1);
    const [event] = events;
    if (!event) throw new Error('no colour event');
    expect(event.frames.from).toBeGreaterThanOrEqual(0.6 * frames.durationInFrames);
    expect(event.frames.durationInFrames).toBeLessThanOrEqual(69);
    expect(event.frames.durationInFrames).toBe(42);
  });
});

describe('the examples cover both skins and both cards', () => {
  it('puts the simple card on Neutral Cut and the frosted one on Kinetic Plate', () => {
    const quill = payoffs['quillhaven-payoff']();
    const nova = payoffs['nova-payoff']();
    expect(skinOf(quill.brand.colors.background)).toBe('neutral-cut');
    expect(skinOf(nova.brand.colors.background)).toBe('kinetic-plate');
    expect(at(quill.scenes, 3).props).toEqual({ card: 'simple' });
    expect(at(nova.scenes, 3).props).toEqual({ card: 'frosted' });
  });
});
