/**
 * The hard spend cap inside one stage of a film. The film command gives each stage a ceiling no
 * larger than what the film has left; this client makes the stage's own code keep to it, whatever
 * that code asks for. Naive stops a session at its budget, so a session can never spend more than
 * the budget it was created with. Every `sessions.create` is therefore clamped to the room left
 * under the ceiling, holding each running session's whole budget until it stops; a `sessions.send`
 * that would wake a session is refused unless the rest of its budget fits; and an image is
 * generated only while its estimate fits. A stage can run several sessions at once (the Art
 * Director's reviews) or one after another (a Director retry after a budget pause), and none of
 * them can take the film past its cap.
 */
import type { Naive } from '../naive/client.ts';

/** Naive refuses a Sonnet or Opus session with a budget under $1. */
export const MIN_SESSION_MICRO_USD = 1_000_000;

/** What one generated image is budgeted at before the generator says what it cost. */
export const IMAGE_ESTIMATE_MICRO_USD = 50_000;

export class CapReached extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapReached';
  }
}

type SessionState = { status?: string; consumed_micro_usd?: number };

/** The part of the Naive client the cap watches. Everything else passes through untouched. */
export interface CappableClient {
  sessions: {
    create: (body: never) => Promise<{ id: string }>;
    send: (id: string, body: never) => Promise<unknown>;
    get: (id: string) => Promise<SessionState>;
  };
  media?: { images: { generate: (body: never) => Promise<{ cost_micro_usd: number }> } };
}

export interface CapOptions {
  /** What the stage may spend in all, in micro-USD. */
  ceilingMicroUsd: number;
  minSessionMicroUsd?: number;
  imageEstimateMicroUsd?: number;
  /** How long a create waits for a running session to stop before giving up. */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Capped<C> {
  /** The client to hand the stage. */
  client: C;
  /** Every session created through it, in order. */
  sessions: string[];
  /** Spent or held now: running sessions at their budget, stopped ones at what they used. */
  committedMicroUsd(): Promise<number>;
  /** Images generated through it, in micro-USD. */
  mediaMicroUsd(): number;
}

const live = (state: SessionState | undefined) =>
  !state || state.status === 'running' || state.status === 'queued';

/** Wraps `client` so the stage it is given can never spend more than `ceilingMicroUsd`. */
export function capClient<C extends CappableClient>(base: C, options: CapOptions): Capped<C> {
  const floor = options.minSessionMicroUsd ?? MIN_SESSION_MICRO_USD;
  const estimate = options.imageEstimateMicroUsd ?? IMAGE_ESTIMATE_MICRO_USD;
  const waitMs = options.waitMs ?? 10 * 60_000;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const budgets = new Map<string, number>();
  const order: string[] = [];
  let media = 0;
  // Creates and sends are taken one at a time, so two of them never both count the same room.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const states = async () =>
    Promise.all(
      [...budgets].map(async ([id, budget]) => ({
        id,
        budget,
        state: await base.sessions.get(id).catch(() => undefined),
      })),
    );

  /** Spent or held, leaving out `except`. */
  const committed = async (except?: string) => {
    let total = media;
    for (const { id, budget, state } of await states()) {
      if (id === except) continue;
      total += live(state) ? budget : Math.max(0, state?.consumed_micro_usd ?? budget);
    }
    return total;
  };

  const create = async (body: { budget_micro_usd?: number }) => {
    const wanted = body.budget_micro_usd ?? floor;
    const until = Date.now() + waitMs;
    for (;;) {
      const attempt = await serial(async () => {
        const room = options.ceilingMicroUsd - (await committed());
        const budget = Math.min(wanted, room);
        if (budget < floor) {
          return { room, running: (await states()).some(({ state }) => live(state)) };
        }
        const session = await base.sessions.create({ ...body, budget_micro_usd: budget } as never);
        budgets.set(session.id, budget);
        order.push(session.id);
        return { session };
      });
      if ('session' in attempt) return attempt.session;
      // Room may come back when a running session stops and is counted at what it used, so a
      // create waits for that, outside the queue, rather than failing a batch that could run.
      if (!attempt.running || Date.now() > until) {
        throw new CapReached(
          `no session started: $${(Math.max(0, attempt.room) / 1e6).toFixed(2)} is left under this stage's cap of $${(options.ceilingMicroUsd / 1e6).toFixed(2)}, and a session needs $${(floor / 1e6).toFixed(2)}`,
        );
      }
      await sleep(2000);
    }
  };

  const send = (id: string, body: unknown) =>
    serial(async () => {
      const budget = budgets.get(id);
      // A woken session may spend up to its whole budget again, so that budget must still fit
      // beside everything else the stage has spent or holds.
      if (budget !== undefined) {
        const room = options.ceilingMicroUsd - (await committed(id));
        if (budget > room) {
          throw new CapReached(
            `session ${id} not continued: its budget of $${(budget / 1e6).toFixed(2)} no longer fits under this stage's cap, with $${(Math.max(0, room) / 1e6).toFixed(2)} left beside the stage's other spend`,
          );
        }
      }
      return base.sessions.send(id, body as never);
    });

  const generate = (body: unknown) =>
    serial(async () => {
      const room = options.ceilingMicroUsd - (await committed());
      if (room < estimate) {
        throw new CapReached(
          `no image generated: $${(Math.max(0, room) / 1e6).toFixed(2)} is left under this stage's cap`,
        );
      }
      const result = await (base.media as NonNullable<C['media']>).images.generate(body as never);
      media += result.cost_micro_usd;
      return result;
    });

  const bind = (target: object, prop: string | symbol) => {
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const sessions = new Proxy(base.sessions, {
    get: (target, prop) =>
      prop === 'create' ? create : prop === 'send' ? send : bind(target, prop),
  });
  const images = base.media
    ? new Proxy(base.media.images, {
        get: (target, prop) => (prop === 'generate' ? generate : bind(target, prop)),
      })
    : undefined;
  const mediaProxy = base.media
    ? new Proxy(base.media, {
        get: (target, prop) => (prop === 'images' ? images : bind(target, prop)),
      })
    : undefined;
  const client = new Proxy(base, {
    get: (target, prop) =>
      prop === 'sessions'
        ? sessions
        : prop === 'media' && mediaProxy
          ? mediaProxy
          : bind(target, prop),
  }) as C;
  return {
    client,
    sessions: order,
    committedMicroUsd: () => committed(),
    mediaMicroUsd: () => media,
  };
}

/** `capClient` over the real client, typed as it. */
export const capNaive = (client: Naive, options: CapOptions): Capped<Naive> =>
  capClient(client as unknown as CappableClient, options) as unknown as Capped<Naive>;
