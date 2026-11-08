import { describe, expect, it, vi } from 'vitest';
import { layoutRefusals } from '../src/film/copy-fit.ts';
import { FilmRejected, prepareFilm } from '../src/film/prepare.ts';
import type { FilmIssue } from '../src/film/validate-film.ts';
import { exampleProbe, novaCopy } from './fixtures.ts';

const CARD =
  'TYPE_CARD_LAYOUT at scene "value", text "value-line": "Analytics, errors and replays" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.';
const NAME =
  'TYPE_CARD_LAYOUT at scene "name", text "name-descriptor": "Your product\'s context layer" does not fit on one line of 1248 px at a cap height of 78 px. Shorten the copy: a type card never sets type below its cap height.';
const STAT =
  'LAYOUT_UNFIT: Scene "proof", text "proof-label": the label "x" does not fit 2 lines of 900 px at the sentence cap height (78 px) at 1920x1080. Shorten the label.';

describe('layoutRefusals', () => {
  it("reads each refusal out of a render's output once, from its code on", () => {
    const output = [
      '{"type":"progress","renderedFrames":267}',
      `SymbolicateableError [TypeCardLayoutError]: ${CARD}`,
      `Error: ${CARD}`,
      `    at measure (http://localhost:3000/bundle.js:6115:13)`,
      `StatCounterLayoutError: ${STAT}`,
    ].join('\n');
    expect(layoutRefusals(output)).toEqual([CARD, STAT]);
  });

  it('splits a rejection printed on one line into one refusal per scene', () => {
    const line = `This campaign cannot be rendered: laying out the copy found 2 error(s). (1) TYPE_CARD_LAYOUT at scenes[3].text[0].value: ${CARD} Shorten scenes[3].text[0].value. (2) TYPE_CARD_LAYOUT at scenes[17].text[1].value: ${NAME} Shorten scenes[17].text[1].value.`;
    expect(layoutRefusals(line)).toEqual([
      `${CARD} Shorten scenes[3].text[0].value.`,
      `${NAME} Shorten scenes[17].text[1].value.`,
    ]);
  });

  it('finds nothing in a failure that is not a refusal', () => {
    expect(
      layoutRefusals('POST /v1/computers/cmp_1/exec/stream ended without an exit frame'),
    ).toEqual([]);
  });
});

describe('prepareFilm copy check', () => {
  const unfit: FilmIssue = {
    code: 'TYPE_CARD_LAYOUT',
    severity: 'error',
    path: 'scenes[1].text[0].value',
    message: CARD,
    fix: 'Shorten scenes[1].text[0].value.',
  };

  it('refuses the film, naming every scene whose copy the templates would refuse', async () => {
    const copy = vi.fn(async () => [
      unfit,
      { ...unfit, path: 'scenes[2].text[1].value', message: NAME },
    ]);
    const rejection = prepareFilm(
      { campaign: novaCopy(), format: '16:9' },
      { ...exampleProbe(), copy },
    );
    await expect(rejection).rejects.toThrow(FilmRejected);
    await expect(rejection).rejects.toThrow(/laying out the copy found 2 error\(s\)/);
    const error = (await rejection.catch((cause) => cause)) as FilmRejected;
    expect(layoutRefusals(error.message)).toHaveLength(2);
  });

  it('measures the cut being rendered, in its format', async () => {
    const copy = vi.fn(async () => []);
    await prepareFilm(
      { campaign: novaCopy(), format: '9:16', hookId: 'open-question' },
      { ...exampleProbe(), copy },
    );
    expect(copy).toHaveBeenCalledTimes(1);
    const [campaign, format] = copy.mock.calls[0] as unknown as [
      { scenes: { id: string }[] },
      string,
    ];
    expect(format).toBe('9:16');
    expect(campaign.scenes[0]?.id).toBe('open-question');
  });
});
