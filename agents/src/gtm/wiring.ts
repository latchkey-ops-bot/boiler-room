import { APP_BASE_PLACEHOLDER } from './config.ts';
import type { Transport } from './fetcher.ts';
import { GtmNaive, type NaiveLike } from './guard.ts';
import {
  AgentMailClient,
  AppFilmOrder,
  AppGtm,
  NaiveAgentRunner,
  NaiveBoard,
  NaiveDataRuns,
  NaiveSocial,
} from './live.ts';
import {
  type AgentRunner,
  type Board,
  type DataRuns,
  DryRunEmailSender,
  DryRunFilmOrder,
  DryRunGtmApp,
  DryRunSocial,
  type EmailSender,
  type FilmOrder,
  type GtmApp,
  LocalBoard,
  type SocialPoster,
} from './ports.ts';

/**
 * Builds the executor's ports. In dry run no live class that posts, sends or orders is
 * constructed, and neither the AgentMail key nor any sender credential is read: a test asserts
 * both. The executor's own Naive key (`GTM_NAIVE_API_KEY`, a separately minted key with the
 * executor's scopes, never the founder's) is read in every mode, because discovery's data runs, the
 * agents' sessions and the board need it; without it those steps are skipped and the report says so.
 */

export const SECRETS = {
  executorKey: 'GTM_NAIVE_API_KEY',
  identity: 'GTM_IDENTITY_ID',
  appUrl: 'GTM_APP_URL',
  serviceToken: 'GTM_SERVICE_TOKEN',
  agentMail: 'AGENTMAIL_API_KEY',
} as const;

/** Names a dry run must never read. */
export const SEND_SECRETS: readonly string[] = [
  SECRETS.agentMail,
  'COLD_SENDER_API_KEY',
  'COLD_SENDER_PASSWORD',
];

export interface Ports {
  naive: GtmNaive | null;
  agents: AgentRunner | null;
  data: DataRuns | null;
  board: Board;
  film: FilmOrder;
  social: SocialPoster;
  sender: EmailSender;
  app: GtmApp;
  /** The mailbox read for reply opt-outs. Not built until the inbox phase (S6). */
  replyInbox: { account: string } | null;
  /** AgentMail's org send block list: a second lock behind suppression. Null in dry run. */
  blockList: ((address: string, reason: string) => Promise<void>) | null;
  transport: Transport;
  mx: (domain: string) => Promise<boolean>;
  appBase: string;
}

export interface WiringInput {
  dryRun: boolean;
  /** Write the company board instead of a local file. */
  useBoard: boolean;
  /** `GTM_ACTIVE`: only then are agent sessions started. */
  gtmActive: boolean;
  /** Reads a secret by name, or null when it is not set. */
  secret: (name: string) => string | null;
  transport: Transport;
  mx: (domain: string) => Promise<boolean>;
  now: () => string;
  appBase: string | null;
  /** Builds the Naive client from the executor's key. */
  naiveClient: (key: string) => NaiveLike;
  /** The fetch the app clients use. */
  fetcher: ConstructorParameters<typeof AppFilmOrder>[2];
  log: (line: string) => void;
  /**
   * The X posts earlier runs made (`postsWeMade(store)`). The guard deletes only posts it knows, and
   * every `gtm:day` is a new process, so without these a removal could never delete an older post.
   */
  knownPosts?: readonly string[];
  /** For tests: called with each live class's name as it is constructed. */
  onLive?: (name: string) => void;
}

export async function createPorts(input: WiringInput): Promise<Ports> {
  const live = (name: string) => input.onLive?.(name);
  const appBase = input.appBase ?? APP_BASE_PLACEHOLDER;
  let naive: GtmNaive | null = null;
  const key = input.secret(SECRETS.executorKey);
  if (key) {
    try {
      const identity = input.secret(SECRETS.identity);
      naive = await GtmNaive.connect(input.naiveClient(key), {
        identity: input.dryRun ? null : identity,
        knownPosts: input.knownPosts ?? [],
      });
    } catch (error) {
      input.log(
        `naive     not connected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    input.log(`naive     ${SECRETS.executorKey} is not set: no data runs, sessions or board`);
  }

  const agents = naive && input.gtmActive ? new NaiveAgentRunner(naive) : null;
  const data = naive ? new NaiveDataRuns(naive) : null;
  const board: Board = input.useBoard && naive ? new NaiveBoard(naive) : new LocalBoard(input.now);

  let film: FilmOrder = new DryRunFilmOrder(appBase);
  let social: SocialPoster = new DryRunSocial();
  let app: GtmApp = new DryRunGtmApp();
  let blockList: Ports['blockList'] = null;
  const sender: EmailSender = new DryRunEmailSender();
  if (!input.dryRun) {
    const url = input.secret(SECRETS.appUrl);
    const token = url ? input.secret(SECRETS.serviceToken) : null;
    if (url && token) {
      live('AppFilmOrder');
      film = new AppFilmOrder(url, token, input.fetcher);
      live('AppGtm');
      app = new AppGtm(url, token, input.fetcher);
    }
    if (naive) {
      live('NaiveSocial');
      social = new NaiveSocial(naive);
    }
    const agentMailKey = input.secret(SECRETS.agentMail);
    if (agentMailKey) {
      live('AgentMailClient');
      const agentMail = new AgentMailClient(agentMailKey, input.fetcher);
      blockList = async (address, reason) => {
        await agentMail.blockSend(address, reason);
      };
    }
    // No cold sender exists until the founder chooses one (gtm-operations.md section 12), and
    // AgentMail's terms forbid cold outreach, so first-touch email has no live sender to build.
  }
  return {
    naive,
    agents,
    data,
    board,
    film,
    social,
    sender,
    app,
    replyInbox: null,
    blockList,
    transport: input.transport,
    mx: input.mx,
    appBase,
  };
}
