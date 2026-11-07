import { validateCampaign } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { SCENE_TYPES, sceneRegistry } from '../src/scenes/registry.ts';
import { at, examples, novaCopy } from './fixtures.ts';

describe('sceneRegistry', () => {
  it('names the first four scenes', () => {
    expect(SCENE_TYPES).toEqual(['kinetic-title', 'interface-reveal', 'feature-sequence', 'cta']);
  });

  it.each(Object.entries(examples))(
    'passes %s through validateCampaign as it stands',
    async (_name, copy) => {
      const campaign = copy();
      expect(await validateCampaign(campaign, { sceneRegistry })).toEqual({
        ok: true,
        issues: [],
        campaign,
      });
    },
  );

  it('lets validateCampaign reject a scene type no template draws', async () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).type = 'carousel';
    const { issues } = await validateCampaign(campaign, { sceneRegistry });
    expect(issues.map(({ code }) => code)).toEqual(['SCENE_TYPE_UNKNOWN']);
    expect(issues[0]?.fix).toContain('kinetic-title, interface-reveal, feature-sequence, cta');
  });

  it('applies its own text limits through validateCampaign', async () => {
    const campaign = novaCopy();
    at(at(campaign.scenes, 1).text, 0).value = `faster builds ${'x'.repeat(40)}`;
    const { issues } = await validateCampaign(campaign, { sceneRegistry });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'TEXT_TOO_LONG', message: expect.stringContaining('48') }),
    );
  });

  it('gives every scene type a component, a props schema and limits', () => {
    for (const definition of Object.values(sceneRegistry)) {
      expect(typeof definition.component).toBe('function');
      expect(definition.props.safeParse({}).success).toBe(true);
      expect(Object.keys(definition.text).length).toBeGreaterThan(0);
      for (const role of Object.keys(definition.roles)) {
        expect(definition.text).toHaveProperty(role);
      }
    }
  });
});
