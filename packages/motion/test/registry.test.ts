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
  it('draw nine of the scene types in the schema registry, under its names', () => {
    expect(IMPLEMENTED_SCENE_TYPES).toEqual([
      'word-slam',
      'logo-reveal',
      'site-hero',
      'type-card',
      'site-scroll',
      'proof-bars',
      'stat-counter',
      'feature-card',
      'end-card',
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
      'logo-reveal': {
        kind: 'mark',
        ground: 'base plate',
        anchors: [{ id: 'logo', entry: undefined, exit: { axis: 'y', sign: -1, v: 36 } }],
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
      'type-card': {
        kind: 'type',
        ground: 'base plate',
        anchors: [
          {
            id: 'headline',
            entry: { axis: 'x', sign: 1, v: 46 },
            exit: { axis: 'x', sign: 1, v: 46 },
          },
        ],
      },
      'site-scroll': {
        kind: 'product',
        ground: 'base plate',
        anchors: [{ id: 'browser', entry: undefined, exit: { axis: 'x', sign: 1, v: 46 } }],
      },
      'proof-bars': {
        kind: 'proof',
        ground: 'base plate',
        anchors: [
          {
            id: 'headline',
            entry: { axis: 'x', sign: 1, v: 46 },
            exit: { axis: 'x', sign: 1, v: 46 },
          },
          { id: 'bar-0', entry: undefined, exit: undefined },
          { id: 'bar-1', entry: undefined, exit: undefined },
          { id: 'bar-2', entry: undefined, exit: undefined },
        ],
      },
      'stat-counter': {
        kind: 'proof',
        ground: 'base plate',
        anchors: [
          {
            id: 'number',
            entry: { axis: 'x', sign: 1, v: 46 },
            exit: { axis: 'x', sign: 1, v: 46 },
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
    });
  });

  it('give every template a component and a props schema that needs no props', () => {
    // site-scroll's pages are capture data it cannot land page 2 without, so it needs them.
    const needsProps = new Set(['site-scroll']);
    for (const [type, definition] of Object.entries(sceneImplementations)) {
      expect(typeof definition.component).toBe('function');
      expect(definition.props.safeParse({}).success).toBe(!needsProps.has(type));
    }
  });
});

describe('validateForRender', () => {
  /** A type the scene library specifies that no template draws yet. */
  const unbuilt = Object.keys(sceneRegistry).find(
    (type) => !IMPLEMENTED_SCENE_TYPES.includes(type),
  ) as string;

  it.each(Object.entries(examples))('passes %s as it stands', async (_name, copy) => {
    const campaign = copy();
    expect(await validateForRender(campaign)).toEqual({ ok: true, issues: [], campaign });
  });

  it('refuses a scene type the library specifies but no template draws, by name', async () => {
    const campaign = novaCopy();
    at(campaign.scenes, 1).type = unbuilt;
    const { ok, issues } = await validateForRender(campaign);
    expect(ok).toBe(false);
    expect(issues).toEqual([
      {
        code: 'SCENE_TYPE_UNBUILT',
        severity: 'error',
        path: 'scenes[1].type',
        message: `Scene type "${unbuilt}" is in the scene library, but motion has no template for it yet, so it cannot be rendered.`,
        fix: `Change scenes[1].type to a type motion renders: ${IMPLEMENTED_SCENE_TYPES.join(', ')}. Or keep it and render once the ${unbuilt} template is built.`,
      },
    ]);
  });

  it('refuses a hook of a type with no template', async () => {
    const campaign = novaCopy();
    at(campaign.variants.hooks, 0).type = unbuilt;
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
    expect(issues[0]?.fix).toContain(IMPLEMENTED_SCENE_TYPES.join(', '));
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
