import {
  CEO,
  DESIGN,
  ENGINEER,
  ENGINEERING_LEAD,
  GTM_LEAD,
  INBOX_READER,
  PRODUCT,
  SCOUT,
  SOCIAL_AGENT,
} from '../src/definitions/company/common.ts';

/**
 * Every practice agent, skill and branch starts with this, and teardown deletes everything that
 * does. No real company name starts with it.
 */
export const EVAL_PREFIX = 'br-eval-';

/** The branch prefixes an eval may create in either repo. Teardown deletes every one of them. */
export const EVAL_BRANCH_PREFIXES = ['feat/eval-', 'eval/', 'spec/eval-'] as const;

/** Each real company name and the suffix its practice clone takes. */
export const ROLE_SUFFIX: Readonly<Record<string, string>> = {
  [CEO]: 'ceo',
  [ENGINEERING_LEAD]: 'eng-lead',
  [ENGINEER]: 'engineer-1',
  [PRODUCT]: 'product',
  [DESIGN]: 'design',
  [GTM_LEAD]: 'gtm-lead',
  [SCOUT]: 'scout',
  [SOCIAL_AGENT]: 'social',
  [INBOX_READER]: 'inbox-reader',
  'br-ceo-sweep': 'ceo-sweep',
};

/** The skill slugs a company agent can name in its prompt or skill text. */
export const SKILL_SLUGS = [
  'ceo',
  'eng-lead',
  'engineer',
  'product',
  'design',
  'engineering-deploy',
] as const;

/** The real names the practice text must never hold, longest first. */
export const REAL_NAMES = Object.keys(ROLE_SUFFIX).sort((a, b) => b.length - a.length);

/** A run id: short, lowercase, and safe in an agent name, a skill slug and a branch name. */
export function runId(scenario: string, random: () => number = Math.random): string {
  const tag = scenario
    .split('-')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 4);
  const tail = Array.from(
    { length: 4 },
    () => '0123456789abcdefghjkmnpqrstvwxyz'[Math.floor(random() * 32)],
  ).join('');
  return `${tag}${tail}`;
}

export interface PracticeNames {
  run: string;
  /** Real agent name to practice agent name. */
  agents: ReadonlyMap<string, string>;
  /** Real skill slug to practice skill slug. */
  skills: ReadonlyMap<string, string>;
}

export function practiceNames(run: string): PracticeNames {
  if (!/^[a-z0-9]{3,12}$/.test(run)) throw new Error(`Not a run id: ${run}`);
  const agents = new Map(
    REAL_NAMES.map((name) => [name, `${EVAL_PREFIX}${run}-${ROLE_SUFFIX[name]}`]),
  );
  const skills = new Map(SKILL_SLUGS.map((slug) => [slug, `${EVAL_PREFIX}${run}-${slug}`]));
  return { run, agents, skills };
}

const NAME_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_-])(${REAL_NAMES.map((name) => name.replace(/[-]/g, '\\-')).join('|')})(?![A-Za-z0-9_-])`,
  'g',
);

/**
 * Rewrites a prompt, skill or card text for a practice team: every real agent name becomes its
 * practice clone's, and every reference to a skill by slug becomes the practice skill's. One pass,
 * so a name already rewritten is never rewritten again. A card a practice agent writes is assigned
 * by name, and a name resolves across the whole organization, so a real name left here would start
 * a real agent on a practice card.
 */
export function substitute(text: string, names: PracticeNames): string {
  let out = text.replace(NAME_PATTERN, (name) => names.agents.get(name) ?? name);
  for (const [slug, practice] of names.skills) {
    const quoted = slug.replace(/[-]/g, '\\-');
    out = out
      .replace(new RegExp(`(skill\\s+)"${quoted}"`, 'g'), `$1"${practice}"`)
      .replace(new RegExp(`(skill\\s+)\`${quoted}\``, 'g'), `$1\`${practice}\``)
      .replace(new RegExp(`^name: ${quoted}$`, 'gm'), `name: ${practice}`);
  }
  // The deploy skill is also named bare, as in "follow `engineering-deploy`, ...".
  const deploy = names.skills.get('engineering-deploy');
  if (deploy) out = out.replace(/(?<![A-Za-z0-9_-])engineering-deploy(?![A-Za-z0-9_-])/g, deploy);
  return out;
}

/** Real agent names that are still in a text. Empty means the text is safe to give a clone. */
export function realNamesIn(text: string): string[] {
  return [...new Set(text.match(NAME_PATTERN) ?? [])];
}

/**
 * Fills `{ceo}`, `{eng-lead}`, `{engineer-1}`, `{product}`, `{design}`, `{run}` and any value such
 * as `{dev_sha}` or `{card_dir}` in a seed text. A placeholder with no value is left as it is.
 */
export function fill(
  template: string,
  names: PracticeNames,
  extra: Record<string, string> = {},
): string {
  return template.replace(/\{([a-z0-9_-]+)\}/g, (whole, key: string) => {
    if (key === 'run') return names.run;
    if (key in extra) return extra[key] as string;
    const real = Object.entries(ROLE_SUFFIX).find(([, suffix]) => suffix === key)?.[0];
    return real ? (names.agents.get(real) ?? whole) : whole;
  });
}
