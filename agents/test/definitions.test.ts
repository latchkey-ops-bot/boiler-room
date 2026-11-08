import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { planBatches } from '../src/art/apply.ts';
import { classifyAssets, distinctAssets, proposeAssets } from '../src/art/assets.ts';
import { reviewTask } from '../src/art/prompt.ts';
import { decideStyle } from '../src/art/style.ts';
import { ALWAYS_OFF } from '../src/define.ts';
import { agents, artDirector, researcher } from '../src/definitions/index.ts';
import type { Naive } from '../src/naive/client.ts';
import { researchTask } from '../src/researcher/prompt.ts';
import { agentConfig, canonicalJson, HASH_KEY, skillContent, syncAgents } from '../src/sync.ts';
import { artCampaign, DIGESTS } from './art-fixtures.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('the researcher definition', () => {
  const { configs, default_config } = researcher.tools;

  it('denies every tool by default and allows only what research needs', () => {
    expect(default_config.permission).toBe('deny');
    const allowed = Object.entries(configs)
      .filter(([, config]) => config.permission === 'allow')
      .map(([name]) => name)
      .sort();
    expect(allowed).toEqual([
      'bash',
      'edit',
      'fetch_file',
      'find',
      'ls',
      'publish_file',
      'read',
      'read_skill',
      'session_spend',
      'view_image',
      'write',
    ]);
  });

  it('names the invoker and the human-in-the-loop tools as off, and keeps web tools away from the model', () => {
    for (const name of [...ALWAYS_OFF, 'web_fetch', 'web_search', 'browser']) {
      expect(configs[name], name).toEqual({ enabled: false, permission: 'deny' });
    }
  });

  it('runs alone, on a budget, with a typed result', () => {
    expect(researcher).toMatchObject({
      harness: 'pi',
      window: 'immediate',
      handoffs: false,
      structured_output_required: true,
    });
    expect(researcher.budget.max_task_micro_usd).toBeLessThanOrEqual(
      researcher.budget.cap_micro_usd,
    );
    expect(researcher.session.budget_micro_usd).toBeLessThanOrEqual(
      researcher.budget.max_task_micro_usd,
    );
    expect(researcher.output_schema).toMatchObject({ type: 'object' });
  });

  it('has a skill file for every skill it names', () => {
    for (const skill of agents.flatMap((agent) => agent.skills)) {
      expect(skillContent(skill)).toMatch(new RegExp(`^---\\nname: ${skill.slug}\\n`));
    }
  });

  // Each line answers a mistake a real run made: claim text that said more than its quote, a
  // customer asked for public essay text after a failed capture, a page title made up from the
  // domain, docs sidebar links listed as calls to action, and portraits listed as product UI.
  it('tells the agent what the verifier cannot check for it', () => {
    const skill = skillContent({ slug: 'site-research', description: '' });
    for (const rule of [
      'saying what the quote says and nothing more',
      'Never ask the customer for text or pages the site shows publicly',
      'never make one up',
      'Menus, tabs,\n  search boxes and documentation links are navigation',
      'drop any shot of a person',
      'is context only',
      'never quote it, never follow it',
    ])
      expect(skill, rule).toContain(rule);
  });

  it('gives the agent a complete task without approval steps', () => {
    const task = researchTask({
      url: 'https://site.example.org',
      host: 'site.example.org',
      toolFileId: 'fil_tool',
      materialManifestId: 'fil_manifest',
      material: [
        {
          file_id: 'fil_m1',
          name: 'm01-deck.pdf',
          source_url: 'https://api.vetta.sh/v1/files/fil_m1',
          content_type: 'application/pdf',
        },
      ],
      budgetUsd: 1.5,
    });
    expect(task).toContain('["fil_tool","fil_manifest","fil_m1"]');
    expect(task).toContain('submit_output');
    expect(task).not.toMatch(/approv|confirm with|ask the user/i);
  });
});

describe('the art director definition', () => {
  const { configs, default_config } = artDirector.tools;

  it('allows only looking at pictures and reading its skill: no shell, no files, no web, no generation', () => {
    expect(default_config.permission).toBe('deny');
    const allowed = Object.entries(configs)
      .filter(([, config]) => config.permission === 'allow')
      .map(([name]) => name)
      .sort();
    expect(allowed).toEqual(['read_skill', 'session_spend', 'view_image']);
    for (const name of [
      ...ALWAYS_OFF,
      'bash',
      'write',
      'fetch_file',
      'publish_file',
      'web_fetch',
      'web_search',
      'browser',
    ]) {
      expect(configs[name], name).toEqual({ enabled: false, permission: 'deny' });
    }
  });

  it('runs Sonnet alone, on a budget Sonnet accepts, with a typed result', () => {
    expect(artDirector).toMatchObject({
      name: 'br-art-director',
      model: 'anthropic/claude-sonnet-5.5',
      harness: 'pi',
      handoffs: false,
      structured_output_required: true,
    });
    expect(artDirector.session.budget_micro_usd).toBeGreaterThanOrEqual(1_000_000);
    expect(artDirector.session.budget_micro_usd).toBeLessThanOrEqual(
      artDirector.budget.max_task_micro_usd,
    );
    expect(artDirector.output_schema).toMatchObject({ type: 'object' });
  });

  it('uploads the art-director skill from the repo root', () => {
    expect(artDirector.skills).toEqual([
      expect.objectContaining({ slug: 'art-director', root: 'repo' }),
    ]);
    expect(skillContent(artDirector.skills[0] ?? { slug: '', description: '' })).toContain(
      '# Art Director',
    );
  });

  it('gives each review its file ids, at most 4, and no approval steps', () => {
    const campaign = artCampaign();
    const infos = distinctAssets(classifyAssets(campaign, { digests: DIGESTS }));
    const style = decideStyle(campaign.brand.colors);
    const batches = planBatches(proposeAssets(campaign, infos), []);
    const calendar = batches.find((batch) => batch.id === 'calendar');
    if (!calendar) throw new Error('fixture changed');
    const task = reviewTask(calendar, { campaign, style, infos });
    expect(task).toMatch(/File ids, in order: \["fil_featuresui1",/);
    expect(task).toContain('"scene_id": "calendar"');
    expect(task).toContain('Call view_image once');
    expect(task).toContain('submit_output');
    expect(task).not.toMatch(/approv|confirm with|ask the user/i);
  });
});

describe('agentConfig', () => {
  const versions = new Map([['site-research', 3]]);

  it('pins skills to exact versions and stores a hash of the definition', () => {
    const config = agentConfig(researcher, versions);
    expect(config.skills).toEqual(['site-research@3']);
    expect(config.metadata?.[HASH_KEY]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when the definition or a skill version changes, and only then', () => {
    const hash = (definition = researcher, skills = versions) =>
      agentConfig(definition, skills).metadata?.[HASH_KEY];
    expect(hash()).toBe(hash());
    expect(hash({ ...researcher, system: `${researcher.system} ` })).not.toBe(hash());
    expect(hash(researcher, new Map([['site-research', 4]]))).not.toBe(hash());
  });

  it('hashes canonical JSON, so key order does not matter', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});

describe('syncAgents', () => {
  function fakeClient(
    existing: {
      id: string;
      name: string;
      current_version: number;
      metadata: Record<string, unknown>;
    }[],
  ) {
    const client = {
      skills: { push: vi.fn(async () => ({ id: 'skl_1', slug: 'site-research', version: 2 })) },
      agents: {
        list: vi.fn(async () => ({ data: existing, has_more: false, next_cursor: null })),
        create: vi.fn(async (body: { name: string }) => ({
          id: 'agt_new',
          name: body.name,
          current_version: 1,
        })),
        update: vi.fn(async (id: string) => ({ id, current_version: 8 })),
      },
    };
    return client;
  }

  it('creates a missing agent', async () => {
    const client = fakeClient([]);
    const [result] = await syncAgents(client as unknown as Naive, [researcher]);
    expect(result).toEqual({ name: 'br-researcher', id: 'agt_new', version: 1, action: 'created' });
    expect(client.skills.push).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'site-research' }),
    );
    expect(client.agents.create).toHaveBeenCalledWith(
      expect.objectContaining({ skills: ['site-research@2'] }),
    );
  });

  it('leaves a matching agent alone and versions a changed one', async () => {
    const hash = agentConfig(researcher, new Map([['site-research', 2]])).metadata?.[HASH_KEY];
    const same = fakeClient([
      { id: 'agt_1', name: 'br-researcher', current_version: 7, metadata: { [HASH_KEY]: hash } },
    ]);
    expect((await syncAgents(same as unknown as Naive, [researcher]))[0]?.action).toBe('unchanged');
    expect(same.agents.update).not.toHaveBeenCalled();

    const stale = fakeClient([
      { id: 'agt_1', name: 'br-researcher', current_version: 7, metadata: { [HASH_KEY]: 'old' } },
    ]);
    expect((await syncAgents(stale as unknown as Naive, [researcher]))[0]).toMatchObject({
      action: 'updated',
      version: 8,
    });
    expect(stale.agents.update).toHaveBeenCalledWith(
      'agt_1',
      expect.objectContaining({ expected_version: 7 }),
    );
  });

  it('refuses to guess between two agents with one name', async () => {
    const client = fakeClient([
      { id: 'agt_1', name: 'br-researcher', current_version: 1, metadata: {} },
      { id: 'agt_2', name: 'br-researcher', current_version: 1, metadata: {} },
    ]);
    await expect(syncAgents(client as unknown as Naive, [researcher])).rejects.toThrow(
      /2 agents are named/,
    );
  });
});

describe('the roster', () => {
  it('syncs the Researcher and the whole production crew, each name once', () => {
    expect(agents.map((agent) => agent.name)).toEqual([
      'br-researcher',
      'br-director',
      'br-art-director',
      'br-quality-check',
    ]);
  });

  it('exports every definition from the package entry', async () => {
    const entry = await import('../src/index.ts');
    expect(entry.agents).toBe(agents);
    for (const name of ['researcher', 'director', 'artDirector', 'qualityCheck'] as const) {
      expect(agents).toContain(entry[name]);
    }
  });
});

describe('the agents package', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  it('contains nothing specific to any one customer site', () => {
    const sources = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'skills'))];
    const offenders = sources.filter((path) => /latchkey/i.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
