import { campaignJsonSchema } from '@boiler-room/schema';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { ALWAYS_OFF } from '../src/define.ts';
import { director } from '../src/definitions/index.ts';
import { researchFacts, tourPlan } from '../src/director/checks.ts';
import { directorOutputJsonSchema, OUTREACH_BRIEF } from '../src/director/output.ts';
import { DIRECTOR_SKILLS, directorTask, repairMessage } from '../src/director/prompt.ts';
import { agentConfig, skillContent } from '../src/sync.ts';
import { exampleResearch, exampleSubmission } from './director-fixtures.ts';

describe('the director definition', () => {
  const { configs, default_config } = director.tools;

  it('has no shell, files or web: it reads its skills and submits', () => {
    expect(default_config.permission).toBe('deny');
    const allowed = Object.entries(configs)
      .filter(([, config]) => config.permission === 'allow')
      .map(([name]) => name)
      .sort();
    expect(allowed).toEqual(['read_skill', 'session_spend']);
    for (const name of [
      ...ALWAYS_OFF,
      'bash',
      'web_fetch',
      'web_search',
      'browser',
      'publish_file',
    ]) {
      expect(configs[name], name).toEqual({ enabled: false, permission: 'deny' });
    }
  });

  it('runs alone with a typed result on a Sonnet-or-better budget', () => {
    expect(director).toMatchObject({
      name: 'br-director',
      harness: 'pi',
      window: 'immediate',
      handoffs: false,
      structured_output_required: true,
      output_schema: directorOutputJsonSchema,
    });
    expect(director.session.budget_micro_usd).toBeGreaterThanOrEqual(1_000_000);
    expect(director.session.budget_micro_usd).toBeLessThanOrEqual(
      director.budget.max_task_micro_usd,
    );
    expect(director.budget.max_task_micro_usd).toBeLessThanOrEqual(director.budget.cap_micro_usd);
  });

  it('attaches the director skill and its four companions from skills/, by slug', () => {
    expect(director.skills.map((skill) => skill.slug)).toEqual([...DIRECTOR_SKILLS]);
    for (const skill of director.skills) {
      expect(skill.root).toBe('repo');
      expect(skillContent(skill)).toMatch(new RegExp(`^---\\nname: ${skill.slug}\\n`));
      expect(skill.description.length).toBeGreaterThan(40);
    }
    const versions = new Map(DIRECTOR_SKILLS.map((slug, index) => [slug, index + 1]));
    expect(agentConfig(director, versions).skills).toEqual(
      DIRECTOR_SKILLS.map((slug, index) => `${slug}@${index + 1}`),
    );
  });
});

describe('the output schema', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats.default(ajv);
  const validate = ajv.compile(directorOutputJsonSchema);

  it('holds campaignJsonSchema unchanged under campaign', () => {
    const { $schema: _dialect, ...campaign } = campaignJsonSchema as Record<string, unknown>;
    expect((directorOutputJsonSchema.properties as Record<string, unknown>).campaign).toEqual(
      campaign,
    );
  });

  it('accepts the worked example with its handoff, and refuses either part alone', () => {
    const submission = exampleSubmission();
    expect(validate(submission), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ campaign: submission.campaign })).toBe(false);
    expect(validate({ ...submission, campaign: { ...submission.campaign, notes: 'x' } })).toBe(
      false,
    );
  });
});

describe('the director task', () => {
  const research = exampleResearch();
  const task = directorTask({
    research,
    brief: OUTREACH_BRIEF,
    facts: researchFacts(research),
    filesOnHand: new Set(['logo', 'home']),
    budgetUsd: 2.5,
    tour: tourPlan(research, OUTREACH_BRIEF),
  });

  it('says up front that the site-scroll row becomes a site-hero, and why', () => {
    expect(task).toContain(
      'The research does not support a site-scroll: the research records no CTA box',
    );
    expect(task).toContain(
      'write the site-scroll row (Standard row 5, Long row 8) as a site-hero: the row\'s start and end, assetIds ["pr-panel"], or ["home"] if row 3\'s site-hero shows "pr-panel"',
    );
    expect(task).toContain('transitionOut "t3"');
  });

  it('gives the brief, the counted facts, the asset list and the research, with no approval steps', () => {
    expect(task).toContain('Kind: outreach-sample. Rule 1 of §1 applies: Short.');
    expect(task).toContain('Claims with status "extracted" may be cited on screen');
    expect(task).toContain('Product surfaces (distinct captured pages): 2.');
    expect(task).toContain(
      '- pr-panel: image 1200x800, captured, from https://fernhook.example.com/product',
    );
    expect(task).toContain('FILE MISSING');
    expect(task).toContain('"preview-speed"');
    expect(task).not.toContain('fil_pages');
    expect(task).toContain('submit_output');
    expect(task).not.toMatch(/ask the user|confirm with|wait for approval/i);
  });

  it('numbers each issue with its fix in a repair message', () => {
    const message = repairMessage(
      [
        {
          code: 'SEAM',
          severity: 'error',
          path: 'campaign.scenes[2].transitionOut',
          message: 'Seam 3 is "t16".',
          fix: 'Set it to "t3".',
          owner: 'director',
        },
      ],
      1,
      3,
    );
    expect(message).toContain(
      '1. SEAM at campaign.scenes[2].transitionOut: Seam 3 is "t16".\n   Fix: Set it to "t3".',
    );
  });
});
