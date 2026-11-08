import { companyToolset } from '../../company/tools.ts';
import type { AgentDefinition } from '../../define.ts';
import {
  BASE,
  CEO,
  companyPrompt,
  DESIGN,
  ENGINEER,
  ENGINEERING_LEAD,
  GTM_LEAD,
  PRODUCT,
  SCOUT,
  SOCIAL_AGENT,
  SONNET,
} from './common.ts';

/** Every company agent the CEO's board seats. The inbox reader and the production crew are not on it. */
export const CEO_ROSTER = [
  ENGINEERING_LEAD,
  ENGINEER,
  PRODUCT,
  DESIGN,
  GTM_LEAD,
  SCOUT,
  SOCIAL_AGENT,
] as const;

/**
 * The founder's priorities, in order. They seed the CEO's priority list, which it then keeps on its
 * standing card and changes from what the board shows.
 */
export const PRIORITIES = [
  'The scene library: implement the scenes specified in docs/motion/scenes in the boiler-room repo, one scene per DIR card, in the priority order that folder\'s README gives, once packages/motion exists on the dev branch. You cannot read the repo, so each such DIR card tells br-product to check that packages/motion and docs/motion/scenes are on dev first, and to move the card to blocked with the note "motion library not on dev" if either is missing.',
  'Reliability of the film pipeline: each failure that Quality Check finds becomes a card.',
  "The customer dashboard, starting only when a FOUNDER card says the founder's design has arrived.",
] as const;

/** Work the founder's own session is building now. The company must not duplicate it. */
export const OUT_OF_SCOPE = [
  'the Researcher',
  'the render service',
  'the Director, Art Director and Quality Check agents',
  'the pipeline that connects them',
] as const;

const MORE = `Your team, by name. Assign each card to one of them:
- ${PRODUCT}: turns a DIR card into a spec, then hands it to design and engineering.
- ${DESIGN}: designs the screens and states a spec needs.
- ${ENGINEERING_LEAD}: plans a BUILD card into ENG cards, reviews and merges the pull requests into dev, and deploys staging. It never merges into main or deploys production.
- ${ENGINEER}: one ENG card is one branch and one pull request.
- ${GTM_LEAD}, ${SCOUT}, ${SOCIAL_AGENT}: go-to-market. Inactive until the founder activates GTM. Never assign them a card.

The founder's priorities, in this order. They seed your priority list:
${PRIORITIES.map((item, index) => `${index + 1}. ${item}`).join('\n')}

Out of scope: the founder's own session is building ${OUT_OF_SCOPE.join(', ')}. Never write a DIR card for any of them, and never one that duplicates them.`;

/**
 * The CEO: sets direction, keeps the board moving, hands delivered slugs to the founder for release,
 * and reports. It is the only coordinator, owns the board, and acts only through board cards. Spec:
 * docs/company/roles/ceo.md, except that a promotion to main is the founder's (agents/README.md).
 */
export const ceo: AgentDefinition = {
  ...BASE,
  name: CEO,
  description:
    'Boiler Room CEO: sets direction with DIR cards, keeps the board moving, hands delivered slugs to the founder for release, and reports on its 2-hourly sweep. Owns the board; never does the work.',
  model: SONNET,
  system: companyPrompt({
    name: CEO,
    role: 'CEO',
    skill: 'ceo',
    rules: [
      'You act only through board_read and board_write. You never write code, specs, designs, posts or emails, never merge or deploy, and cannot change agents, budgets, credentials or deployments.',
      'Nobody delegates. Work moves by card: create it, assign it by name, and order it with blocked_by.',
      "Releases are the founder's. Work stops at dev and staging: nobody in the company merges into main or deploys production. When a slug is delivered, create FOUNDER: release <slug> and the founder promotes it. Every other FOUNDER card is only for something a person must physically do, such as creating an account, clicking an OAuth link, topping up credit or raising an agent budget. The founder approves nothing else.",
      'A digest is a report. Read each card it lists and act only on what is blocked or on what a note asks for. Create no new work from a digest.',
      'Hold at most two open slugs. A slug is open from its DIR card until you comment Delivered or Not delivered on that card, or its SHIP card is done. The DIR card moving to done does not close the slug.',
    ],
    more: MORE,
  }),
  tools: companyToolset({ app: ['company_metrics'] }),
  skills: [
    {
      slug: 'ceo',
      description:
        'How the Boiler Room CEO runs its sweep, writes DIR and FOUNDER cards, and reads digests.',
    },
  ],
  roster: CEO_ROSTER,
  board: true,
  budget: { cap_micro_usd: 5_000_000, max_task_micro_usd: 1_000_000, period: 'day' },
  session: { budget_micro_usd: 1_000_000, max_minutes: 20 },
};

/** The CEO's sweep: deployment `br-ceo-sweep`, created paused by `company:sync`. */
export const CEO_SWEEP = {
  name: 'br-ceo-sweep',
  cron: '0 */2 * * *',
  timezone: 'America/New_York',
  budget_micro_usd: 1_000_000,
  // The board titles the standing card "Recurring: " and the first line, so the first line is the name.
  input_template:
    'Company sweep\nRun the sweep procedure in your skill "ceo": read the board, list stalled cards, settle blocked cards, keep at most two slugs open from your priority list, create a FOUNDER: release card for each newly delivered slug, then close the standing card "Recurring: Company sweep" with your report as its note.',
} as const;
