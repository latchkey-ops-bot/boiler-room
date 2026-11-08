import { sceneRegistry } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { validateForRender } from '../src/film/validate-render.ts';
import { anchorVelocities, groundOf } from '../src/scenes/definition.ts';
import {
  IMPLEMENTED_SCENE_TYPES,
  renderSceneRegistry,
  sceneImplementations,
} from '../src/scenes/registry.ts';
import { at, examples, novaCopy } from './fixtures.ts';

describe('scene templates', () => {
  it('draw five of the scene types in the schema registry, under its names', () => {
    expect(IMPLEMENTED_SCENE_TYPES).toEqual([
      'word-slam',
      'site-hero',
      'feature-card',
      'end-card',
      'tile-wall',
    ]);
    for (const type of IMPLEMENTED_SCENE_TYPES)
      expect(Object.hasOwn(sceneRegistry, type)).toBe(true);
  });

  it("restrict the schema registry to those types, keeping the schema's own limits", () => {
    expect(renderSceneRegistry).toEqual(
      Object.fromEntries(IMPLEMENTED_SCENE_TYPES.map((type) => [type, sceneRegistry[type]])),
    );
  });

  it.each(Object.entries(sceneImplementations))(
    '%s sets only roles the schema gives a limit',
    (type, definition) => {
      const limited = Object.keys(sceneRegistry[type]?.text ?? {});
      expect(limited).toEqual(expect.arrayContaining(Object.keys(definition.roles)));
    },
  );

  it('declare the kind, ground and anchors each scene file gives', () => {
    const declared = Object.fromEntries(
      Object.entries(sceneImplementations).map(([type, definition]) => [
        type,
        {
          kind: definition.kind,
          ground:
            groundOf(definition, {}, 'neutral-cut') +
            ' ' +
            groundOf(definition, {}, 'kinetic-plate'),
          anchors: anchorVelocities(definition, {}),
        },
      ]),
    );
    expect(declared).toEqual({
      'word-slam': {
        kind: 'type',
        ground: 'base plate',
        anchors: [{ id: 'headline', entry: undefined, exit: undefined }],
      },
      'site-hero': {
        kind: 'product',
        ground: 'base plate',
        anchors: [
          {
            id: 'browser',
            entry: { axis: 'y', sign: -1, v: 36 },
            exit: { axis: 'scale', sign: 1, v: 0.03 },
          },
        ],
      },
      'feature-card': {
        kind: 'product',
        ground: 'base plate',
        anchors: [
          {
            id: 'headline',
            entry: { axis: 'x', sign: 1, v: 46 },
            exit: { axis: 'x', sign: 1, v: 46 },
          },
        ],
      },
      'end-card': {
        kind: 'mark',
        ground: 'base plate',
        anchors: [{ id: 'logo', entry: { axis: 'y', sign: -1, v: 36 }, exit: undefined }],
      },
      'tile-wall': {
        kind: 'product',
        ground: 'base plate',
        anchors: [{ id: 'wall', entry: undefined, exit: undefined }],
      },
    });
  });

  it('give every template a component and a props schema that needs no props', () => {
    for (const definition of Object.values(sceneImplementations)) {
      expect(typeof definition.component).toBe('function');
      expect(definition.props.safeParse({}).success).toBe(true);
    }
  });
});

describe('validateForRender', () => {
  it.each(Object.entries(examples))('passes %s as it stands', async (_name, copy) => {
    const campaign = copy();
    expect(await validateForRender(campaign)).toEqual({ ok: true, issues: [], campaign });
  });

  it('refuses a scene type the library specifies but no template draws, by name', async () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).type = 'proof-bars';
    const { ok, issues } = await validateForRender(campaign);
    expect(ok).toBe(false);
    expect(issues).toEqual([
      {
        code: 'SCENE_TYPE_UNBUILT',
        severity: 'error',
        path: 'scenes[1].type',
        message:
          'Scene type "proof-bars" is in the scene library, but motion has no template for it yet, so it cannot be rendered.',
        fix: 'Change scenes[1].type to a type motion renders: word-slam, site-hero, feature-card, end-card, tile-wall. Or keep it and render once the proof-bars template is built.',
      },
    ]);
  });

  it('refuses a hook of a type with no template', async () => {
    const campaign = novaCopy();
    at(campaign.variants.hooks, 0).type = 'type-card';
    const { issues } = await validateForRender(campaign);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'SCENE_TYPE_UNBUILT', path: 'variants.hooks[0].type' }),
    ]);
  });

  it('reports a type outside the library as unknown, listing the types that render', async () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).type = 'carousel';
    const { issues } = await validateForRender(campaign);
    expect(issues.map(({ code }) => code)).toEqual(['SCENE_TYPE_UNKNOWN']);
    expect(issues[0]?.fix).toContain('word-slam, site-hero, feature-card, end-card, tile-wall');
  });

  it('applies the limits the schema gives each type', async () => {
    const campaign = novaCopy();
    at(at(campaign.scenes, 1).text, 1).value = 'Every single commit';
    const { issues } = await validateForRender(campaign);
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'TEXT_TOO_LONG',
        path: 'scenes[1].text[1].value',
        message: 'This label is 19 characters, over the limit of 16.',
      }),
    ]);
  });
});
