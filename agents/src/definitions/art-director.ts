import { artDecisionJsonSchema } from '../art/decision.ts';
import { ART_DIRECTOR_SYSTEM } from '../art/prompt.ts';
import type { AgentDefinition } from '../define.ts';
import { toolset } from '../define.ts';

/**
 * Looks at the captured pictures and picks the best for each scene, and inspects every generated
 * image before it is declared. Colours, fonts, the style family, what may be generated and the
 * spend on images are decided in code (`src/art/`), so the model is used only where eyes are.
 *
 * Sonnet 5.5, because choosing the crop that shows a feature is judgement, and it reads pictures
 * well at half the price of Opus. It needs no computer: `view_image` reads Naive files by id, so
 * the agent has no shell, no file tools and no web.
 */
export const artDirector: AgentDefinition = {
  name: 'br-art-director',
  description:
    'Boiler Room Art Director: picks the best captured picture for each scene of a campaign and inspects generated images before they are declared. Colours and generation are decided in code.',
  model: 'anthropic/claude-sonnet-5.5',
  harness: 'pi',
  window: 'immediate',
  system: ART_DIRECTOR_SYSTEM,
  tools: toolset(
    ['view_image', 'read_skill', 'session_spend'],
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
      'web_fetch',
      'web_search',
      'browser',
    ],
  ),
  skills: [
    {
      slug: 'art-director',
      root: 'repo',
      description:
        'How the Art Director chooses the style family, fixes colour, type and logo, assigns captured assets by the asset ladder, and generates only what may be generated.',
    },
  ],
  budget: { cap_micro_usd: 5_000_000, max_task_micro_usd: 1_500_000, period: 'day' },
  output_schema: artDecisionJsonSchema,
  structured_output_required: true,
  handoffs: false,
  // Sonnet sessions need a budget of at least $1.
  session: { budget_micro_usd: 1_000_000, max_minutes: 15 },
};
