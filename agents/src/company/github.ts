/**
 * The company's two GitHub repos and the tokens that write to them. Both repos are public, so a
 * token is the only thing that separates reading from writing.
 */
export const GITHUB_OWNER = 'latchkey-ops-bot';

export const REPOS = {
  code: { name: 'boiler-room', url: `https://github.com/${GITHUB_OWNER}/boiler-room` },
  design: {
    name: 'boiler-room-design',
    url: `https://github.com/${GITHUB_OWNER}/boiler-room-design`,
  },
} as const;

/** The env file variable each token is read from at run time. */
export const TOKENS = {
  engineering: 'BR_GITHUB_TOKEN_ENG',
  design: 'BR_GITHUB_TOKEN_DESIGN',
} as const;
export type TokenName = keyof typeof TOKENS;

export type Repo = (typeof REPOS)[keyof typeof REPOS];

/** The one repo each token is for. Each must be refused by the other repo (spec section 6). */
export const REPO_OF: Record<TokenName, Repo> = {
  engineering: REPOS.code,
  design: REPOS.design,
};

/** The company repo a token must not be able to write to. */
export function otherRepo(token: TokenName): Repo {
  return token === 'engineering' ? REPOS.design : REPOS.code;
}

/**
 * The `~/.netrc` that lets git (over HTTPS) and `curl --netrc` (the REST API) use a token without it
 * ever appearing in a command. GitHub ignores the login for a token, but takes the owner's.
 */
export function netrc(token: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(token)) throw new Error('A GitHub token has an unexpected format.');
  return ['github.com', 'api.github.com']
    .map((host) => `machine ${host}\nlogin ${GITHUB_OWNER}\npassword ${token}\n`)
    .join('');
}
