import { describe, expect, it } from 'vitest';
import { resolveCut } from '../src/film/cut.ts';
import { validateForRender } from '../src/film/validate-render.ts';
import { at, novaCopy, quillhavenCopy } from './fixtures.ts';

describe('resolveCut', () => {
  it('swaps the hook in for the first scene and keeps its way out', () => {
    const campaign = novaCopy();
    const cut = resolveCut(campaign, { hookId: 'open-question' });
    expect(at(cut.scenes, 0).id).toBe('open-question');
    expect(at(cut.scenes, 0).transitionOut).toBe('t3');
    expect(cut.scenes.slice(1)).toEqual(campaign.scenes.slice(1));
  });

  it('puts the chosen CTA label in the end card, citing nothing', () => {
    const cut = resolveCut(novaCopy(), { ctaId: 'book-demo' });
    const cta = at(cut.scenes, 3).text.find(({ role }) => role === 'cta');
    expect(cta).toMatchObject({ value: 'Book a demo', claimIds: [] });
  });

  it('removes the hooks, so the cut validates as it stands', async () => {
    const cut = resolveCut(quillhavenCopy(), { hookId: 'open-blank-page', ctaId: 'see-pricing' });
    expect(cut.variants.hooks).toEqual([]);
    expect((await validateForRender(cut)).ok).toBe(true);
  });

  it('changes nothing it was not asked to', () => {
    const campaign = novaCopy();
    const before = structuredClone(campaign);
    const cut = resolveCut(campaign, {});
    expect(cut.scenes).toEqual(before.scenes);
    expect(campaign).toEqual(before);
  });
});
