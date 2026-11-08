import type { AgentDefinition } from '../define.ts';
import { toolset } from '../define.ts';
import { qcReviewJsonSchema } from '../quality/output.ts';
import { QUALITY_CHECK_SYSTEM } from '../quality/prompt.ts';

/**
 * Decides whether a rendered film ships. Code measures the file first (hashes, size, rate, frame
 * count, black and frozen frames, ground colour, the campaign gate, claims and colours traced to the
 * research); the agent then opens frames taken from the film with `view_image` and judges what only
 * eyes can: legibility, overflow, cropping, brand match and numbers on screen.
 *
 * Sonnet 5.5 is the model, because this is judgement on images, at half the price of Opus. The agent
 * has no shell and no files of its own: `view_image` reads Naive files by id, so it needs no
 * computer, and nothing it does can change the film or the campaign.
 */
export const qualityCheck: AgentDefinition = {
  name: 'br-quality-check',
  description:
    'Boiler Room Quality Check: opens frames taken from a rendered film, judges them against the quality-check skill, and returns pass or fail with issues for the director, art director or motion.',
  model: 'anthropic/claude-sonnet-5.5',
  harness: 'pi',
  window: 'immediate',
  system: QUALITY_CHECK_SYSTEM,
  tools: toolset(
    ['view_image', 'read_skill'],
    // It judges images it is given. It has no shell, no files, no web and no way to publish.
    // Code holds the spend, so session_spend is off too.
    [
      'session_spend',
      'bash',
      'read',
      'write',
      'edit',
      'ls',
      'find',
      'fetch_file',
      'find_files',
      'publish_file',
      'web_fetch',
      'web_search',
      'browser',
    ],
  ),
  skills: [
    {
      slug: 'quality-check',
      root: 'repo',
      description:
        'Pass and fail criteria for a rendered Boiler Room film: contact sheet, transitions, phone-size legibility, brand match, claims, timing and audio.',
    },
  ],
  // Raised on Naive on 8 November to $15 a day and $2 a task; agents:sync keeps them.
  budget: { cap_micro_usd: 15_000_000, max_task_micro_usd: 2_000_000, period: 'day' },
  output_schema: qcReviewJsonSchema,
  structured_output_required: true,
  handoffs: false,
  // Sonnet sessions need a budget of at least $1.
  session: { budget_micro_usd: 1_000_000, max_minutes: 15 },
};
