import type { Campaign } from '@boiler-room/schema';
import nova from '@boiler-room/schema/examples/nova.campaign.json' with { type: 'json' };
import quillhaven from '@boiler-room/schema/examples/quillhaven.campaign.json' with {
  type: 'json',
};
import type { LogoProbe } from '../src/brand/logo.ts';
import type { MediaProbe } from '../src/film/prepare.ts';

export const novaCopy = () => structuredClone(nova) as Campaign;
export const quillhavenCopy = () => structuredClone(quillhaven) as Campaign;
export const examples = { nova: novaCopy, quillhaven: quillhavenCopy };

export const at = <T>(list: readonly T[], index: number): T => list[index] as T;

/** Answers for the files the examples use, as a browser would report them. */
export const exampleProbe = (overrides: Record<string, LogoProbe> = {}): MediaProbe => ({
  image: async (url: string) => {
    const match = Object.keys(overrides).find((key) => url.endsWith(key));
    if (match) return overrides[match] as LogoProbe;
    if (url.endsWith('dashboard.png') || url.endsWith('editor.png')) {
      return { loaded: true, width: 2880, height: 1800 };
    }
    if (url.endsWith('logo.svg')) {
      return {
        loaded: true,
        width: 373,
        height: 112,
        coverage: 0.4,
        palette: [
          { color: '#7799FF', share: 0.55 },
          { color: '#FFFFFF', share: 0.38 },
          { color: '#001122', share: 0.07 },
        ],
      };
    }
    if (url.endsWith('favicon.png')) {
      return {
        loaded: true,
        width: 32,
        height: 32,
        coverage: 0.8,
        palette: [{ color: '#883322', share: 1 }],
      };
    }
    return { loaded: false };
  },
});
