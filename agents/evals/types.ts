import type { PracticeNames } from './names.ts';

export type Role = 'ceo' | 'eng-lead' | 'engineer-1';
export type Status = 'todo' | 'doing' | 'blocked' | 'done';

/** One card the harness writes before the agent under test starts. Texts are `fill` templates. */
export interface CardSeed {
  /** The card's name in this scenario, for `blocked_by` and checks. */
  key: string;
  title: string;
  body?: string;
  status?: Status;
  /** A role suffix such as `engineer-1`, or none. */
  assignee?: string | null;
  blocked_by?: string[];
  /** Written after the create, as the holder's note. A `done` card needs one. */
  note?: string;
  comments?: string[];
}

/** What starts the agent under test. */
export type Step =
  /** A run of the practice CEO's sweep deployment, as the schedule starts it. */
  | { kind: 'sweep' }
  /** The board's own digest for the practice CEO, started by the board clock. */
  | { kind: 'digest' }
  /** A card assigned to the agent under test, which wakes it. */
  | { kind: 'card'; seed: CardSeed };

export interface ToolCall {
  name: string;
  args: unknown;
  /** The command, for a `bash` call. */
  command?: string;
  is_error?: boolean;
  /** The start of the tool's result, for a `bash` call. */
  output?: string;
}

export interface SnapSession {
  id: string;
  /** What started it: one of the steps, or the computer boot. */
  kind: string;
  agent: string;
  status: string;
  stop_reason: string | null;
  consumed_micro_usd: number;
  tools: ToolCall[];
  /** The agent's last message. */
  reply: string;
}

export interface SnapComment {
  author: string;
  body: string;
  created_at: string;
}

export interface SnapCard {
  id: string;
  /** The seed key, for a card the harness wrote. */
  seed: string | null;
  /**
   * Who wrote it: `harness`, `schedule` (a sweep's standing card), the label of the session under
   * test that created it, `stray` when only a session the test cancelled created a card with this
   * title, or `unknown`. Only `stray` cards are left out of the checks.
   */
  author: string;
  title: string;
  body: string;
  status: Status;
  assignee: string | null;
  blocked_by: string[];
  note: string | null;
  woken_session_id: string | null;
  created_at: string;
  updated_at: string;
  comments: SnapComment[];
}

export interface Snapshot {
  board_id: string;
  cards: SnapCard[];
  sessions: SnapSession[];
  /** Sessions of practice agents the harness did not start, cancelled on sight. */
  strays: { agent: string; session: string; status: string }[];
  /** Real company agents started on the practice board. Each fails the scenario. */
  violations: string[];
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Context {
  names: PracticeNames;
  /** Values the fixtures produced, such as `pr_url`, for seeds, checks and the judge. */
  vars: Record<string, string>;
  /** The `main` commit of the code repo before the scenario. */
  main_before: string | null;
  main_after: string | null;
  /** The practice agent under test. */
  agent: string;
}

export interface Scenario {
  id: string;
  role: Role;
  /** A safety scenario must pass for the role to pass, whatever its score. */
  safety: boolean;
  title: string;
  /** What is tested and what good looks like, for the docs and the judge. */
  summary: string;
  /** What `~/.netrc` holds on the agent's computer: nothing, a token that cannot write, or the real one. */
  credentials: 'none' | 'decoy' | 'real';
  /** How long the seeded cards must age before the first step, in minutes. */
  age_minutes?: number;
  /** Board digests of the practice CEO that may run. Any other session is cancelled. */
  digests?: number;
  /** GitHub fixtures, made before the seeds. Returns the values the seeds fill in. */
  fixtures?: (input: {
    names: PracticeNames;
    vars: Record<string, string>;
  }) => Promise<Record<string, string>>;
  seeds: CardSeed[];
  steps: Step[];
  checks: (snapshot: Snapshot, context: Context) => Check[] | Promise<Check[]>;
  /** Facts beyond the board for the judge, such as a pull request's state. */
  facts?: (snapshot: Snapshot, context: Context) => Promise<Record<string, unknown>>;
  rubric: string[];
}

export const check = (name: string, pass: boolean, detail = ''): Check => ({ name, pass, detail });
