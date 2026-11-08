import type { Campaign } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { validateFilm } from '../src/film/validate-film.ts';
import { decodingUrl, urlCapacity, urlShown } from '../src/scenes/end-card.tsx';
import { at, novaCopy, quillhavenCopy } from './fixtures.ts';

/** Nova with its end card cut to a length in frames, showing a URL revealed one way. */
function novaEndCard(frames: number, url: string, urlReveal?: 'decode' | 'type'): Campaign {
  const campaign = novaCopy();
  const close = at(campaign.scenes, 3);
  close.end = close.start + frames / campaign.fps;
  campaign.durationSeconds = close.end;
  close.props = urlReveal ? { urlReveal } : {};
  close.text = close.text.map((item) => (item.role === 'label' ? { ...item, value: url } : item));
  return campaign;
}

const tooShort = (campaign: Campaign) =>
  validateFilm(campaign, '16:9').filter(({ code }) => code === 'SCENE_TOO_SHORT');

describe('the end card hold', () => {
  it('shows a URL in full by the frame before the hold at the lengths the scene file gives', () => {
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
    // At the length it names, the URL is typed in full before the hold.
    const frames = Number(/at least (\d+) frames/.exec(fix)?.[1]);
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

  it('counts the frames a carry in takes from the build', () => {
    // Quillhaven, 24 fps, with a word slam before its end card, and the end card 95 frames long.
    const campaign = quillhavenCopy();
    delete at(campaign.scenes, 1).transitionOut;
    Object.assign(at(campaign.scenes, 2), {
      type: 'word-slam',
      props: {},
      assetIds: [],
      text: [{ id: 'features-headline', role: 'headline', value: 'Kept.', claimIds: [] }],
    });
    const close = at(campaign.scenes, 3);
    close.end = close.start + 95 / 24;
    campaign.durationSeconds = close.end;
    // 36 characters decode by spec frame 41. After a cut the card builds from its first frame,
    // and the frame before its hold, 39, is spec frame 48.75.
    close.text = close.text.map((item) =>
      item.role === 'label' ? { ...item, value: `quillhaven.example.com/${'a'.repeat(13)}` } : item,
    );
    expect(tooShort(campaign)).toEqual([]);
    // A carry of the mark in lands 9 frames into the card, and the build starts only then.
    at(campaign.scenes, 2).transitionOut = 'carry';
    expect(tooShort(campaign)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('not fully decoded') }),
    ]);
    // Its logo is carried in, so it does not rise and is not reported.
    expect(tooShort(campaign)[0]?.message).not.toContain('logo');
  });

  it('passes both examples', () => {
    expect(tooShort(novaCopy())).toEqual([]);
    expect(tooShort(quillhavenCopy())).toEqual([]);
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

  it('shows punctuation and digits final from the first frame of a decode', () => {
    expect(decodingUrl('ab.c1', 6)).toBe('de.f1');
    expect(urlShown('ab.c1', 'decode', 5)).toBe('');
  });
});
