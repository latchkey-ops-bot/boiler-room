import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sceneRegistry, validateCampaign } from '../src/index.ts';
import { directorExample } from './director-example.ts';

const scenesDir = new URL('../../../docs/motion/scenes/', import.meta.url);

/** The scene types the motion docs specify, one file each. */
const documentedTypes = readdirSync(scenesDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .map((name) => name.slice(0, -'.md'.length));

/** The `text` row of a scene file's registry table, such as `{ headline: 40 }`, as an object. */
function documentedText(type: string): unknown {
  const doc = readFileSync(new URL(`${type}.md`, scenesDir), 'utf8');
  const row = doc.split('\n').find((line) => line.startsWith('| `text`'));
  const literal = row?.match(/`(\{[^`]*\})`/)?.[1];
  if (!literal) throw new Error(`${type}.md has no \`text\` row with an object`);
  return JSON.parse(literal.replace(/(\w+):/g, '"$1":'));
}

describe('sceneRegistry', () => {
  it('holds exactly the scene types in docs/motion/scenes', () => {
    expect(Object.keys(sceneRegistry).sort()).toEqual(documentedTypes.sort());
    expect(documentedTypes).toHaveLength(15);
  });

  it.each(documentedTypes)('gives %s the text limits its scene file states', (type) => {
    expect(sceneRegistry[type]?.text).toEqual(documentedText(type));
  });

  it("replaces the default headline limit with a scene type's own", async () => {
    const campaign = directorExample();
    const proof = campaign.scenes.find((scene) => scene.type === 'stat-counter');
    const number = proof?.text.find((item) => item.role === 'headline');
    if (!number) throw new Error('the example has no stat-counter headline');
    number.value = 'Under 90 seconds flat';

    const { ok, issues } = await validateCampaign(campaign, { sceneRegistry });

    expect(ok).toBe(false);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'TEXT_TOO_LONG',
        message: 'This headline is 21 characters, over the limit of 10.',
      }),
    );
  });

  it('rejects a scene type outside the library', async () => {
    const campaign = directorExample();
    const [hook] = campaign.scenes;
    if (!hook) throw new Error('the example has no scenes');
    hook.type = 'fade-title';

    const { issues } = await validateCampaign(campaign, { sceneRegistry });

    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'SCENE_TYPE_UNKNOWN', path: 'scenes[0].type' }),
    );
  });
});
