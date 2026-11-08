import type { TokenName } from '../../company/github.ts';
import type { AgentDefinition } from '../../define.ts';
import { CEO_ROSTER, CEO_SWEEP, ceo, OUT_OF_SCOPE, PRIORITIES } from './ceo.ts';
import { DESIGN, ENGINEER, ENGINEERING_LEAD, PRODUCT } from './common.ts';
import { engineer, engineeringLead } from './engineering.ts';
import { gtmLead, inboxReader, scout, social } from './gtm.ts';
import { design, product } from './product-design.ts';

/**
 * The company around the product, as code. `pnpm company:sync` makes Naive match this list. The
 * production crew (the Researcher and the agents after it) is in `../index.ts` and is not on the
 * board.
 */
export const company: readonly AgentDefinition[] = [
  ceo,
  engineeringLead,
  engineer,
  product,
  design,
  gtmLead,
  scout,
  social,
  inboxReader,
];

/** Which GitHub token goes into `~/.netrc` on whose computer. */
export const NETRC: Readonly<Record<string, TokenName>> = {
  [ENGINEERING_LEAD]: 'engineering',
  [ENGINEER]: 'engineering',
  [PRODUCT]: 'design',
  [DESIGN]: 'design',
};

export const GTM = [gtmLead, scout, social, inboxReader] as const;

export {
  CEO_ROSTER,
  CEO_SWEEP,
  ceo,
  design,
  engineer,
  engineeringLead,
  gtmLead,
  inboxReader,
  OUT_OF_SCOPE,
  PRIORITIES,
  product,
  scout,
  social,
};
