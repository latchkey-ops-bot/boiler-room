import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oklchLightness, toOklch } from '@boiler-room/schema';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CAP,
  GENERATED_LICENSE,
  generateImages,
  generationNeeds,
  plateRamp,
} from '../src/art/generate.ts';
import { decideStyle } from '../src/art/style.ts';
import type { Naive } from '../src/naive/client.ts';
import { artCampaign } from './art-fixtures.ts';

const needsFor = (primary: string) => {
  const campaign = artCampaign({ primary });
  const style = decideStyle(campaign.brand.colors);
  campaign.brand.colors = style.colors;
  return { needs: generationNeeds(campaign, style), campaign, style };
};

describe('generationNeeds', () => {
  it('generates only the iso-chain texture when the primary reads well', () => {
    const { needs } = needsFor('#5850EC');
    expect(needs.map((need) => [need.assetId, need.purpose, need.sceneIds])).toEqual([
      ['hero-texture', 'hero-texture', ['chain']],
    ]);
    expect(needs[0]?.aspectRatio).toBe('1:1');
  });

  it('adds a field for colour-event when the primary reads as nothing', () => {
    const { needs } = needsFor('#222222');
    const field = needs.find((need) => need.purpose === 'event-field');
    expect(field).toMatchObject({
      assetId: 'event-field',
      sceneIds: ['event'],
      aspectRatio: '16:9',
    });
  });

  it('forbids text, numbers, logos, interface and people in every prompt', () => {
    for (const need of needsFor('#222222').needs) {
      expect(need.prompt).toMatch(/No text, no letters, no words, no digits, no numbers, no logos/);
      expect(need.prompt).toMatch(/no user interface, no screens, no people/);
    }
  });

  it('builds the field from the plate ramp: L 0.12, the primary at L 0.45 or less, the accent', () => {
    const colors = { background: '#FFFFFF', foreground: '#000000', primary: '#9FA8FF' };
    const [deep, mid, far] = plateRamp(colors);
    expect(oklchLightness(deep)).toBeCloseTo(0.12, 2);
    expect(oklchLightness(mid)).toBeCloseTo(0.45, 2);
    expect(toOklch(mid).h).toBeCloseTo(toOklch('#9FA8FF').h ?? Number.NaN, -1);
    expect(oklchLightness(far)).toBeCloseTo(0.3, 2);
    expect(plateRamp({ ...colors, accent: '#FFB86B' })[2]).toBe('#FFB86B');
    expect(needsFor('#222222').needs.find((n) => n.purpose === 'event-field')?.prompt).toContain(
      'radial gradient',
    );
  });

  it('generates nothing again for a slot that already holds an image', () => {
    const { campaign, style } = needsFor('#222222');
    campaign.assets['event-field'] = {
      kind: 'image',
      src: 'naive://files/fil_a',
      provenance: 'generated',
    };
    campaign.assets['hero-texture'] = {
      kind: 'image',
      src: 'naive://files/fil_b',
      provenance: 'generated',
    };
    for (const scene of campaign.scenes) {
      if (scene.type === 'colour-event') scene.assetIds = ['event-field'];
      if (scene.type === 'iso-chain') scene.assetIds = ['hero-texture'];
    }
    expect(generationNeeds(campaign, style)).toEqual([]);
  });

  it('never takes an id that is already declared', () => {
    const campaign = artCampaign();
    campaign.assets['hero-texture'] = { kind: 'svg', src: 'x.svg', provenance: 'captured' };
    const style = decideStyle(campaign.brand.colors);
    expect(generationNeeds(campaign, style)[0]?.assetId).toBe('hero-texture-b');
  });
});

describe('generateImages', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function fakeClient(cost = 15_000) {
    let n = 0;
    const generate = vi.fn(async () => {
      n += 1;
      return {
        object: 'image_generation' as const,
        model: 'test/model',
        cost_micro_usd: cost,
        files: [{ id: `fil_gen${n}`, content_type: 'image/jpeg', width: 1824, height: 1024 }],
      };
    });
    const downloadBytes = vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    return {
      client: { media: { images: { generate } }, files: { downloadBytes } } as unknown as Pick<
        Naive,
        'media' | 'files'
      >,
      generate,
    };
  }

  it('declares each image as generated, from Naive files, with no source URL, and saves a copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'art-'));
    dirs.push(dir);
    const { client, generate } = fakeClient();
    const { needs } = needsFor('#222222');
    const result = await generateImages(client, needs, { outDir: dir });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.spentMicroUsd).toBe(30_000);
    const [first] = result.generated;
    expect(first?.asset).toEqual({
      kind: 'image',
      src: 'naive://files/fil_gen1',
      provenance: 'generated',
      license: GENERATED_LICENSE,
      width: 1824,
      height: 1024,
    });
    expect(first?.asset).not.toHaveProperty('sourceUrl');
    expect(readFileSync(join(dir, 'assets', 'generated', 'event-field.jpg'))).toHaveLength(3);
  });

  it('stops at the image cap', async () => {
    const { client, generate } = fakeClient();
    const { needs } = needsFor('#222222');
    const result = await generateImages(client, needs, { cap: { ...DEFAULT_CAP, maxImages: 1 } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.skipped[0]?.reason).toMatch(/image cap of 1/);
  });

  it('does not start a call that the estimate says would cross the spend cap', async () => {
    const { client, generate } = fakeClient();
    const { needs } = needsFor('#222222');
    const result = await generateImages(client, needs, {
      cap: { maxImages: 2, maxMicroUsd: 20_000, estimateMicroUsd: 15_000 },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.skipped[0]?.reason).toMatch(/spend cap/);
  });

  it('learns from a dearer image than estimated', async () => {
    const { client, generate } = fakeClient(60_000);
    const { needs } = needsFor('#222222');
    const result = await generateImages(client, needs, {
      cap: { maxImages: 2, maxMicroUsd: 100_000, estimateMicroUsd: 15_000 },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.spentMicroUsd).toBe(60_000);
  });

  it('records a failed call and carries on', async () => {
    const { client, generate } = fakeClient();
    generate.mockRejectedValueOnce(new Error('model unavailable'));
    const { needs } = needsFor('#222222');
    const result = await generateImages(client, needs);
    expect(result.skipped[0]?.reason).toMatch(/model unavailable/);
    expect(result.generated).toHaveLength(1);
  });
});
