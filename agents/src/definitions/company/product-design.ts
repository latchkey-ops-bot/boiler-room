import { REPOS } from '../../company/github.ts';
import { companyToolset } from '../../company/tools.ts';
import type { AgentDefinition } from '../../define.ts';
import { BASE, companyPrompt, DESIGN, MEMBER_RULES, PRODUCT, SONNET } from './common.ts';

/**
 * The staging app's domain, which design's browser is limited to. There is no staging app yet, so
 * the browser stays off: an empty domain list must never mean the open web.
 */
export const STAGING_DOMAIN: string | null = null;

const PRODUCT_DESIGN_RULES = [
  ...MEMBER_RULES,
  `You write to ${REPOS.design.url} only, over HTTPS, with the token git and curl --netrc read from ~/.netrc. You never write to ${REPOS.code.name}; you may read it, because it is public.`,
  "Never post, email or publish anything outside the company, and never use another company's logo or brand assets.",
  'A bash call is killed after about 30 seconds. Put anything longer in a script file, run it with nohup in the background, and poll its log.',
  'Check session_spend before each long step, and move your card to blocked with the note "budget" at two thirds of your task ceiling.',
];

/** Product: turns a DIR card into a testable spec, then hands it to design and engineering. */
export const product: AgentDefinition = {
  ...BASE,
  name: PRODUCT,
  description:
    'Boiler Room product: turns a DIR card into a testable spec in boiler-room-design, then hands it on with DESIGN and BUILD cards.',
  model: SONNET,
  system: companyPrompt({
    name: PRODUCT,
    role: 'product lead',
    skill: 'product',
    rules: PRODUCT_DESIGN_RULES,
  }),
  tools: companyToolset({
    allow: ['bash', 'read', 'write', 'edit', 'ls', 'find', 'publish_file'],
    app: ['feedback_summaries'],
  }),
  skills: [
    {
      slug: 'product',
      description:
        'How Boiler Room product writes a spec from a DIR card and hands it to design and engineering.',
    },
  ],
  budget: { cap_micro_usd: 4_000_000, max_task_micro_usd: 1_000_000, period: 'day' },
  session: { budget_micro_usd: 1_000_000, max_minutes: 30 },
};

/** Design: the screens, states and visuals a spec needs, and the brand's visual system. */
export const design: AgentDefinition = {
  ...BASE,
  name: DESIGN,
  description:
    'Boiler Room design: designs the screens, states and copy a spec needs, checks staging against them, and keeps the visual system.',
  model: SONNET,
  system: companyPrompt({
    name: DESIGN,
    role: 'designer',
    skill: 'design',
    rules: [...PRODUCT_DESIGN_RULES, 'Render at most 4 images per card.'],
  }),
  tools: companyToolset({
    allow: [
      'bash',
      'read',
      'write',
      'edit',
      'ls',
      'find',
      'publish_file',
      'view_image',
      'generate_image',
      'find_stock_photo',
      ...(STAGING_DOMAIN ? ['browser'] : []),
    ],
    app: ['feedback_summaries'],
    configs: STAGING_DOMAIN
      ? {
          browser: {
            enabled: true,
            permission: 'allow',
            config: { allowed_domains: [STAGING_DOMAIN] },
          },
        }
      : {},
  }),
  skills: [
    {
      slug: 'design',
      description:
        'How Boiler Room design turns a spec into screens, states and copy in boiler-room-design.',
    },
  ],
  budget: { cap_micro_usd: 5_000_000, max_task_micro_usd: 1_000_000, period: 'day' },
  session: { budget_micro_usd: 1_000_000, max_minutes: 30 },
};
