import type { AgentDefinition } from '../define.ts';
import { toolset } from '../define.ts';
import { researchOutputJsonSchema } from '../researcher/output.ts';
import { RESEARCHER_SYSTEM } from '../researcher/prompt.ts';

/**
 * Turns any website into verified research: brand tokens, logo, screenshots, claims with verbatim
 * quotes, a brief and what the customer must upload. It browses only through its capture tool, on
 * its own computer, and needs no approval at any step.
 *
 * Haiku 5.5 is the model: it scored 18/18 on the extraction fixture with an injection trap, ran
 * the real capture procedure, and costs about a twentieth of Sonnet. The verifier, not the model,
 * guarantees that quotes are verbatim.
 */
export const researcher: AgentDefinition = {
  name: 'br-researcher',
  description:
    'Boiler Room Researcher: reads any product website read-only (at most 15 pages) and returns its brand, assets, verbatim claims, a brief and what the customer must upload.',
  model: 'anthropic/claude-haiku-5.5',
  harness: 'pi',
  window: 'immediate',
  system: RESEARCHER_SYSTEM,
  tools: toolset(
    [
      'bash',
      'read',
      'write',
      'edit',
      'ls',
      'find',
      'fetch_file',
      'publish_file',
      'view_image',
      'read_skill',
      'session_spend',
    ],
    // Every page load goes through the capture tool, which enforces the page limit and read-only rules.
    ['web_fetch', 'web_search', 'browser'],
  ),
  skills: [
    {
      slug: 'site-research',
      description:
        'How the Researcher captures a product website and writes a verified research result.',
    },
  ],
  budget: { cap_micro_usd: 10_000_000, max_task_micro_usd: 3_000_000, period: 'day' },
  output_schema: researchOutputJsonSchema,
  structured_output_required: true,
  handoffs: false,
  session: { budget_micro_usd: 1_500_000, max_minutes: 30 },
};
