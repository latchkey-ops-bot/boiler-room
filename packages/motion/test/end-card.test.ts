import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Campaign, toFrame } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { filmSeams } from '../src/film/seams.ts';
import { type FilmIssue, validateFilm } from '../src/film/validate-film.ts';
import { decodingUrl, urlCapacity, urlShown } from '../src/scenes/end-card.tsx';
import { at, novaCopy } from './fixtures.ts';

const EXAMPLES = path.resolve(import.meta.dirname, '../../schema/examples');
const readExample = (file: string) =>
  JSON.parse(readFileSync(path.join(EXAMPLES, file), 'utf8')) as Campaign;

/** The last scene, the end card, cut to a length in frames, with its URL replaced if one is given. */
function endCardOf(campaign: Campaign, frames: number, url?: string): Campaign {
  const close = at(campaign.scenes, campaign.scenes.length - 1);
  close.end = (toFrame(close.start, campaign.fps) + frames) / campaign.fps;
  campaign.durationSeconds = close.end;
  if (url !== undefined) {
    close.text = close.text.map((item) => (item.role === 'label' ? { ...item, value: url } : item));
  }
  return campaign;
}

/** Nova, whose end card follows a cut, at a length in frames, showing a URL revealed one way. */
function novaEndCard(frames: number, url: string, urlReveal?: 'decode' | 'type'): Campaign {
  const campaign = endCardOf(novaCopy(), frames, url);
  at(campaign.scenes, 3).props = urlReveal ? { urlReveal } : {};
  return campaign;
}

const tooShort = (campaign: Campaign, selection = {}): FilmIssue[] =>
  validateFilm(campaign, '16:9', selection).filter(({ code }) => code === 'SCENE_TOO_SHORT');

const neededFrames = (fix: string) => Number(/at least (\d+) frames/.exec(fix)?.[1]);

describe('the end card hold', () => {
  it('shows a URL in full on the frame before the hold, at the lengths the scene file gives', () => {
    // Short: 95 frames, hold from 26, so a decoded URL of 20 characters settles on 25.
    expect(tooShort(novaEndCard(95, 'a'.repeat(20)))).toEqual([]);
    expect(tooShort(novaEndCard(95, 'a'.repeat(21)))).toHaveLength(1);
    // Standard: 113 frames, hold from 44. 38 characters decode, 16 are typed.
    expect(tooShort(novaEndCard(113, 'a'.repeat(38)))).toEqual([]);
    expect(tooShort(novaEndCard(113, 'a'.repeat(39)))).toHaveLength(1);
    expect(tooShort(novaEndCard(113, 'a'.repeat(16), 'type'))).toEqual([]);
    expect(tooShort(novaEndCard(113, 'a'.repeat(17), 'type'))).toHaveLength(1);
  });

  it('refuses a typed URL the hold would freeze half typed, and says what fits', () => {
    const issues = tooShort(novaEndCard(113, 'nova.example.com/start', 'type'));
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        path: 'scenes[3]',
        message: expect.stringContaining(
          'the film would end on "nova.example.com/" instead of "nova.example.com/start"',
        ),
      }),
    ]);
    const fix = issues[0]?.fix ?? '';
    expect(fix).toContain('Shorten scenes[3].text[1] to 16 characters or fewer');
    expect(fix).toContain('set scenes[3].props.urlReveal to "decode"');
    // At the length it names, the URL is typed in full before the hold, and not a frame sooner.
    const frames = neededFrames(fix);
    expect(tooShort(novaEndCard(frames, 'nova.example.com/start', 'type'))).toEqual([]);
    expect(tooShort(novaEndCard(frames - 1, 'nova.example.com/start', 'type'))).toHaveLength(1);
  });

  it('refuses a decoding URL the hold would freeze scrambled, and a logo still rising', () => {
    const issues = tooShort(novaEndCard(90, 'nova.example.com/start-free-now'));
    expect(issues.map(({ message }) => message)).toEqual([
      expect.stringContaining('its logo is still rising'),
      expect.stringContaining(
        'the film would end on "qryd.hadpsoh.frm/start-free-now" instead of "nova.example.com/start-free-now"',
      ),
    ]);
    expect(issues[1]?.fix).not.toContain('urlReveal');
  });

  it('times the logo by the seam on a T1 entry, and by its own rise after a cut', () => {
    // nova-type-cards closes with the name type-card into the end card on T1, its logo on the seam.
    const t1 = () => endCardOf(readExample('nova-type-cards.campaign.json'), 85, 'nova.co/go');
    expect(filmSeams(t1()).at(-1)?.used).toBe('t1');
    // 85 frames hold from 16. The seam settles on 14, and the 10-character URL on 15.
    expect(tooShort(t1())).toEqual([]);
    // After a cut the logo rises on its own until frame 23, so the hold would freeze it moving.
    const cut = t1();
    at(cut.scenes, cut.scenes.length - 2).transitionOut = 't3';
    expect(filmSeams(cut).at(-1)?.used).toBe('t3');
    const issues = tooShort(cut);
    expect(issues).toEqual([
      expect.objectContaining({ message: expect.stringContaining('its logo is still rising') }),
    ]);
    expect(neededFrames(issues[0]?.fix ?? '')).toBe(93);
    // A T1 card too short for its seam to settle is refused for that.
    const unsettled = endCardOf(readExample('nova-type-cards.campaign.json'), 82, 'nova.co');
    expect(tooShort(unsettled)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('its logo is still moving in on its T1 seam'),
      }),
    ]);
  });

  it('checks the CTA of the cut being rendered, whose words can outlast a T1 seam', () => {
    const campaign = endCardOf(readExample('nova-type-cards.campaign.json'), 85, 'nova.co/go');
    campaign.variants.ctas.push({
      id: 'long',
      label: 'Try it now and see it go',
      href: 'https://nova.example.com/signup',
    });
    expect(tooShort(campaign)).toEqual([]);
    // Seven words: the last appears on frame 10 and is still 0.8 px low on 15, the frame before
    // the hold.
    const issues = tooShort(campaign, { ctaId: 'long' });
    expect(issues).toEqual([
      expect.objectContaining({
        path: 'scenes[7]',
        message: expect.stringContaining('the last word of its CTA is still rising'),
      }),
    ]);
    expect(neededFrames(issues[0]?.fix ?? '')).toBe(86);
  });

  it('passes every example campaign', () => {
    const files = readdirSync(EXAMPLES).filter((file) => file.endsWith('.campaign.json'));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const campaign = readExample(file);
      for (const format of campaign.variants.formats) {
        expect(
          validateFilm(campaign, format).filter(({ code }) => code === 'SCENE_TOO_SHORT'),
          file,
        ).toEqual([]);
      }
    }
  });
});

describe('urlShown and urlCapacity', () => {
  it('agree: a URL of the capacity at a frame shows in full there, and one more does not', () => {
    for (const reveal of ['decode', 'type'] as const) {
      for (let f = 0; f <= 80; f += 0.625) {
        const n = urlCapacity(reveal, f);
        expect(urlShown('a'.repeat(n), reveal, f)).toBe('a'.repeat(n));
        expect(urlShown('a'.repeat(n + 1), reveal, f)).not.toBe('a'.repeat(n + 1));
      }
    }
  });

  it('shows nothing before the reveal, then punctuation and digits final from its first frame', () => {
    expect(urlShown('ab.c1', 'decode', 5)).toBe('');
    expect(decodingUrl('ab.c1', 6)).toBe('de.f1');
    expect(urlShown('ab.c1', 'decode', 6)).toBe('de.f1');
  });
});
