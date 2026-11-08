import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiContext } from '../src/server/api/context.ts';
import { ApiError } from '../src/server/api/errors.ts';
import {
  createFilm,
  type FilmDetail,
  getFilmDetail,
  MAX_REVISIONS_PER_FILM,
  reviewScript,
} from '../src/server/api/films.ts';
import { PipelineConflictError } from '../src/server/pipeline/index.ts';
import { buildReviewModel } from '../src/server/script-review.ts';
import { contextFor, startWorkerEnv, testClock } from './helpers.ts';

/**
 * The script review's two decisions, end to end on a real local D1: each goes to the pipeline
 * through PipelineClient first, and only then is it recorded, so the screen never shows a decision
 * the crew did not get.
 */

type Proxy = Awaited<ReturnType<typeof startWorkerEnv>>;
let proxy: Proxy;

beforeAll(async () => {
  proxy = await startWorkerEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

let users = 0;
async function filmAwaitingApproval() {
  users += 1;
  const clock = testClock();
  const ctx = await contextFor(
    { userId: `user_review_${users}`, orgId: null },
    proxy.env,
    clock.now,
  );
  // Watch what the app tells the simulated pipeline, while it still does its job.
  const pipeline = ctx.pipelineFor('simulated');
  const approveScript = vi.spyOn(pipeline, 'approveScript');
  const sendBackScript = vi.spyOn(pipeline, 'sendBackScript');
  const { film } = await createFilm(ctx, { url: 'nova.com' });
  clock.advance(31);
  return { ctx, clock, film, approveScript, sendBackScript };
}

/** The review model as the script page builds it. */
function review(detail: FilmDetail) {
  if (!detail.campaign) throw new Error('expected a campaign');
  return buildReviewModel(
    { ...detail, campaign: detail.campaign },
    { maxRevisions: MAX_REVISIONS_PER_FILM },
  );
}

function runIdOf(ctx: ApiContext, filmId: string) {
  return ctx.db.query.films
    .findFirst({ where: (films, { eq }) => eq(films.id, filmId) })
    .then((row) => row?.pipelineRunId);
}

describe('script review decisions', () => {
  it('approving hands the opening, call to action and shapes to the pipeline, which resumes', async () => {
    const { ctx, clock, film, approveScript, sendBackScript } = await filmAwaitingApproval();
    let detail = await getFilmDetail(ctx, film.id);
    expect(detail.campaign).not.toBeNull();
    if (!detail.campaign) return;
    expect(review(detail).state).toBe('waiting');

    detail = await reviewScript(ctx, film.id, {
      decision: 'approve',
      confirmedClaimIds: ['pricing'],
      version: 1,
      hookId: 'open-question',
      ctaId: 'book-demo',
      formats: ['9:16'],
    });

    expect(approveScript).toHaveBeenCalledTimes(1);
    expect(approveScript).toHaveBeenCalledWith(await runIdOf(ctx, film.id), {
      version: 1,
      hookId: 'open-question',
      ctaId: 'book-demo',
      formats: ['9:16'],
      confirmedClaimIds: ['pricing'],
    });
    expect(sendBackScript).not.toHaveBeenCalled();

    // The pipeline picked up from the approval: art direction is next.
    expect(detail.film).toMatchObject({ status: 'working', stage: 'art_direction' });
    expect(detail.events.at(-1)).toMatchObject({
      agent: 'customer',
      message: 'Approved version 1.',
    });
    if (!detail.campaign) return;
    const model = review(detail);
    expect(model.state).toBe('approved');
    expect(model.approved).toEqual({
      hookId: 'open-question',
      ctaId: 'book-demo',
      formats: ['9:16'],
      confirmedClaimIds: ['pricing'],
    });
    expect(model.claims.find((claim) => claim.id === 'pricing')).toMatchObject({
      checked: false,
      confirmedByYou: true,
    });

    // And it delivers exactly what was chosen.
    clock.advance(41);
    detail = await getFilmDetail(ctx, film.id);
    expect(detail.film.status).toBe('done');
    expect(detail.deliverables.map((file) => [file.format, file.hookId, file.ctaId])).toEqual([
      ['9:16', 'open-question', 'book-demo'],
    ]);
  });

  it('sending back hands the note to the pipeline, and version 2 comes back to review', async () => {
    const { ctx, clock, film, approveScript, sendBackScript } = await filmAwaitingApproval();
    const note = "Make the opening punchier, and say 'teams' instead of 'customers'.";

    let detail = await reviewScript(ctx, film.id, { decision: 'send_back', version: 1, note });
    expect(sendBackScript).toHaveBeenCalledWith(await runIdOf(ctx, film.id), { version: 1, note });
    expect(approveScript).not.toHaveBeenCalled();
    if (!detail.campaign) throw new Error('expected a campaign');
    let model = review(detail);
    expect(model.state).toBe('rewriting');
    expect(model.rewriteNote).toBe(note);

    clock.advance(9);
    detail = await getFilmDetail(ctx, film.id);
    if (!detail.campaign) throw new Error('expected a campaign');
    model = review(detail);
    expect(model).toMatchObject({ state: 'waiting', rewriteNote: null });
    expect(model.film.scriptVersion).toBe(2);
  });

  it('records nothing when the pipeline refuses the decision', async () => {
    const { ctx, film, approveScript } = await filmAwaitingApproval();
    approveScript.mockRejectedValueOnce(new PipelineConflictError('The run moved on.'));

    await expect(
      reviewScript(ctx, film.id, {
        decision: 'approve',
        confirmedClaimIds: ['pricing'],
        version: 1,
        hookId: null,
        ctaId: 'start-free',
        formats: ['16:9'],
      }),
    ).rejects.toBeInstanceOf(PipelineConflictError);

    const detail = await getFilmDetail(ctx, film.id);
    expect(detail.approvals).toEqual([]);
    expect(detail.film).toMatchObject({ status: 'needs_you', formats: [] });
  });

  it('refuses choices that are not in the script before telling the pipeline anything', async () => {
    const { ctx, film, approveScript } = await filmAwaitingApproval();
    const error = await reviewScript(ctx, film.id, {
      decision: 'approve',
      confirmedClaimIds: ['pricing'],
      version: 1,
      hookId: 'open-question',
      ctaId: null,
      formats: ['16:9'],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'invalid_choice' });
    expect(approveScript).not.toHaveBeenCalled();
  });

  it('refuses to approve while a number in the film is unconfirmed, before telling the pipeline', async () => {
    const { ctx, film, approveScript } = await filmAwaitingApproval();
    const error = await reviewScript(ctx, film.id, {
      decision: 'approve',
      version: 1,
      hookId: null,
      ctaId: 'start-free',
      formats: ['16:9'],
      confirmedClaimIds: [],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'unconfirmed_claims',
      issues: [{ path: 'confirmedClaimIds', message: 'Plans start at $29 per seat' }],
    });
    expect(approveScript).not.toHaveBeenCalled();
    expect((await getFilmDetail(ctx, film.id)).approvals).toEqual([]);
  });

  it('refuses to confirm a claim that is not in the script', async () => {
    const { ctx, film } = await filmAwaitingApproval();
    const error = await reviewScript(ctx, film.id, {
      decision: 'approve',
      version: 1,
      hookId: null,
      ctaId: 'start-free',
      formats: ['16:9'],
      confirmedClaimIds: ['pricing', 'made-up'],
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 400, code: 'invalid_choice' });
  });
});
