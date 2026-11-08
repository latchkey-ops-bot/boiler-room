import type { AgentDefinition, SkillDefinition } from '../define.ts';
import { toolset } from '../define.ts';
import { directorOutputJsonSchema } from '../director/output.ts';
import { DIRECTOR_SKILLS, DIRECTOR_SYSTEM } from '../director/prompt.ts';
import { skillContent } from '../sync.ts';

/** A skill in the repo's top-level `skills/`, described by its own front matter. */
function repoSkill(slug: string): SkillDefinition {
  const skill: SkillDefinition = { slug, description: '', root: 'repo' };
  const description = /^---\n[\s\S]*?^description: (.+)$/m.exec(skillContent(skill))?.[1];
  if (!description)
    throw new Error(`skills/${slug}/SKILL.md has no description in its front matter.`);
  return { ...skill, description: description.trim() };
}

/**
 * Turns research and a brief into `campaign.json`: the length, one beat template filled frame for
 * frame, the copy and the claims behind it, the seams, and the hook and CTA variants. It has no
 * shell and no web: it reads its skills and submits `{campaign, handoff}`, and the pipeline's
 * validator sends issues back to the same session.
 *
 * Model: Opus 5.5, picked by a side-by-side run against Sonnet 5.5 on the same research (see the
 * agents README). `pnpm direct --model` overrides it for a trial.
 */
export const director: AgentDefinition = {
  name: 'br-director',
  description:
    'Boiler Room Director: writes campaign.json from verified research and a brief, on a fixed beat template, citing a verbatim claim for every number.',
  model: 'anthropic/claude-opus-5.5',
  harness: 'pi',
  window: 'immediate',
  system: DIRECTOR_SYSTEM,
  tools: toolset(
    ['read_skill', 'session_spend'],
    [
      'bash',
      'read',
      'write',
      'edit',
      'ls',
      'find',
      'fetch_file',
      'find_files',
      'publish_file',
      'view_image',
      'web_fetch',
      'web_search',
      'browser',
    ],
  ),
  skills: DIRECTOR_SKILLS.map(repoSkill),
  budget: { cap_micro_usd: 12_000_000, max_task_micro_usd: 3_000_000, period: 'day' },
  output_schema: directorOutputJsonSchema,
  structured_output_required: true,
  handoffs: false,
  session: { budget_micro_usd: 2_500_000, max_minutes: 25 },
};
