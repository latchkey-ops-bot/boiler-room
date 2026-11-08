import {
  contrastRatio,
  oklchLightness,
  sceneRegistry,
  styleFamily,
  toOklch,
  validateCampaign,
} from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { measuredPalette } from '../src/art/run.ts';
import { decideStyle, readsAsNothing, withContrast } from '../src/art/style.ts';
import { artCampaign } from './art-fixtures.ts';

/** Every colour decision must leave a campaign the validator passes on contrast. */
async function contrastIssues(colors: ReturnType<typeof decideStyle>['colors']) {
  const campaign = artCampaign();
  campaign.brand.colors = colors;
  const { issues } = await validateCampaign(campaign, { sceneRegistry });
  return issues.filter((issue) => issue.code === 'CONTRAST_LOW');
}

describe('decideStyle', () => {
  it('puts a dark brand in Kinetic Plate and changes nothing that already passes', () => {
    const colors = {
      background: '#08090A',
      foreground: '#8A8F98',
      primary: '#828FFF',
      muted: '#D0D6E0',
    };
    const style = decideStyle(colors);
    expect(style).toMatchObject({ family: 'kinetic-plate', familyName: 'Kinetic Plate' });
    expect(style.changes).toEqual([]);
    expect(style.colors).toEqual(colors);
    expect(style.backgroundL).toBeCloseTo(0.139, 3);
  });

  it('puts a pale brand in Neutral Cut', () => {
    const style = decideStyle({
      background: '#F9FAFB',
      foreground: '#4B5563',
      primary: '#5850EC',
      accent: '#3182CE',
    });
    expect(style.family).toBe('neutral-cut');
    expect(style.changes).toEqual([]);
  });

  it("tints a mid-tone ground toward the site's own mode, and says so", async () => {
    const colors = { background: '#6E7681', foreground: '#FFFFFF', primary: '#FF5A1F' };
    const style = decideStyle(colors, { mode: 'light' });
    expect(style).toMatchObject({ family: 'neutral-cut', lean: 'light', leanFrom: 'research' });
    expect(styleFamily(style.colors.background)).toBe('neutral-cut');
    expect(style.changes.map((change) => change.token)).toEqual(['background', 'foreground']);
    // White ink cannot read on a pale ground, so it becomes black.
    expect(style.colors.foreground).toBe('#000000');
    expect(await contrastIssues(style.colors)).toEqual([]);
  });

  it('puts a mid-tone ground on the measured page surface nearest it in its family', async () => {
    // posthog.com, 8 November: the hero's #D3DAC6 became a tint, #F7F7F7, the site does not have.
    const colors = { background: '#D3DAC6', foreground: '#111111', primary: '#111111' };
    const measured = {
      surfaces: ['#D3DAC6', '#FDFDF8', '#EEEFE9', '#F3F4EE'],
      others: ['#111111', '#EB9D2A', '#65675E'],
    };
    const style = decideStyle(colors, { mode: 'light', measured });
    expect(style).toMatchObject({ family: 'neutral-cut', lean: 'light' });
    expect(style.colors.background).toBe('#EEEFE9');
    expect(style.changes[0]?.why).toMatch(/page surface the Researcher measured/);
    expect(style.flags).toEqual([]);
    expect(await contrastIssues(style.colors)).toEqual([]);
  });

  it('tints a mid-tone ground only when no measured surface fits its family, and flags it', () => {
    const style = decideStyle(
      { background: '#D3DAC6', foreground: '#111111', primary: '#111111' },
      { mode: 'light', measured: { surfaces: ['#D3DAC6', '#111111'], others: [] } },
    );
    expect(style.colors.background).not.toBe('#D3DAC6');
    expect(styleFamily(style.colors.background)).toBe('neutral-cut');
    expect(style.flags.join(' ')).toMatch(/tint the site does not have/);
  });

  it('swaps a primary that fails contrast for the nearest measured colour that clears it', async () => {
    const style = decideStyle(
      { background: '#FFFFFF', foreground: '#111111', primary: '#9FD4FF' },
      { measured: { surfaces: ['#FFFFFF'], others: ['#111111', '#1D6FD8', '#E5484D'] } },
    );
    expect(style.colors.primary).toBe('#1D6FD8');
    expect(style.flags.join(' ')).toMatch(/the measured colour nearest it/);
    expect(await contrastIssues(style.colors)).toEqual([]);
  });

  it('leans a mid-tone ground to the side where the ink reads better when the site gives no mode', () => {
    const style = decideStyle({ background: '#6E7681', foreground: '#F4F6FB', primary: '#7C9CFF' });
    expect(style).toMatchObject({ family: 'kinetic-plate', lean: 'dark', leanFrom: 'contrast' });
    expect(oklchLightness(style.colors.background)).toBeLessThanOrEqual(0.22);
    expect(style.colors.foreground).toBe('#F4F6FB');
  });

  it('moves a pale primary darker until it clears 3:1, keeping its hue', async () => {
    const colors = { background: '#FFFFFF', foreground: '#111111', primary: '#9FD4FF' };
    const style = decideStyle(colors);
    const [change] = style.changes;
    expect(change).toMatchObject({ token: 'primary', from: '#9FD4FF' });
    expect(contrastRatio(style.colors.primary, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(style.colors.primary, '#FFFFFF')).toBeLessThan(3.3);
    expect(toOklch(style.colors.primary).h).toBeCloseTo(toOklch('#9FD4FF').h ?? Number.NaN, -1);
    expect(style.flags.join(' ')).toMatch(/#9FD4FF was changed/);
    expect(await contrastIssues(style.colors)).toEqual([]);
  });

  it('drops a muted colour that cannot carry labels, so they fall back to ink', () => {
    const style = decideStyle({
      background: '#FFFFFF',
      foreground: '#111111',
      primary: '#5850EC',
      muted: '#C8CCD2',
    });
    expect(style.colors.muted).toBeUndefined();
    expect(style.changes).toEqual([expect.objectContaining({ token: 'muted', to: null })]);
    expect(style.contrast.muted).toBeNull();
  });

  it('reports the contrast it leaves', () => {
    const style = decideStyle({ background: '#FFFFFF', foreground: '#0000EE', primary: '#0000EE' });
    expect(style.contrast.ink).toBeCloseTo(9.4, 1);
    expect(style.contrast.accent).toBeCloseTo(9.4, 1);
  });

  it.each([
    ['#808080', '#FFFFFF', '#FF0000'],
    ['#3B4A6B', '#9AA0A6', '#3B4A6B'],
    ['#C0C0C0', '#C8C8C8', '#D0D0D0'],
    ['#202020', '#262626', '#2A2A2A'],
  ])(
    'always lands %s on one side and passes the validator',
    async (background, foreground, primary) => {
      const style = decideStyle({ background, foreground, primary });
      expect(styleFamily(style.colors.background)).toBe(style.family);
      expect(await contrastIssues(style.colors)).toEqual([]);
    },
  );
});

describe('withContrast', () => {
  it('leaves a colour that already clears the minimum', () => {
    expect(withContrast('#5850EC', '#FFFFFF', 3)).toBe('#5850EC');
  });

  it('moves lighter on a dark ground', () => {
    const next = withContrast('#2A2F7A', '#0B0B0B', 3);
    expect(oklchLightness(next)).toBeGreaterThan(oklchLightness('#2A2F7A'));
    expect(contrastRatio(next, '#0B0B0B')).toBeGreaterThanOrEqual(3);
  });
});

describe('readsAsNothing', () => {
  it('is true for a primary that is near black, near white or grey', () => {
    expect(readsAsNothing('#111111')).toBe(true);
    expect(readsAsNothing('#1A1A40')).toBe(true);
    expect(readsAsNothing('#F2F4FF')).toBe(true);
    expect(readsAsNothing('#7A7F87')).toBe(true);
  });

  it('is false for a saturated primary', () => {
    expect(readsAsNothing('#5850EC')).toBe(false);
    expect(readsAsNothing('#0000EE')).toBe(false);
    expect(readsAsNothing('#828FFF')).toBe(false);
  });
});

describe('the measured colours the Art Director reads', () => {
  it('reads page surfaces by their share of the page, and every other colour after', () => {
    const palette = measuredPalette([
      { hex: '#eeefe9', seen_as: 'surface', share: 0.25 },
      { hex: '#D3DAC6', seen_as: 'surface', share: 0.55 },
      { hex: '#111111', seen_as: 'text', share: null },
      { hex: '#EB9D2A', seen_as: 'button', share: null },
    ] as unknown as Parameters<typeof measuredPalette>[0]);
    expect(palette).toEqual({
      surfaces: ['#D3DAC6', '#EEEFE9'],
      others: ['#111111', '#EB9D2A'],
    });
  });
});
