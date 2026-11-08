import { describe, expect, it } from 'vitest';
import { withPageMessage } from '../src/render-campaign.ts';

describe('withPageMessage', () => {
  it('puts the issues of an error thrown in the page back into its message', () => {
    // What selectComposition throws for calculateMetadata's FilmRejected: one line of message,
    // and the issues only in the stack.
    const error = new Error(
      'FilmRejected: This campaign cannot be rendered: laying out the copy found 2 error(s).',
    );
    error.stack = [
      'FilmRejected: This campaign cannot be rendered: laying out the copy found 2 error(s).',
      '- TYPE_CARD_LAYOUT at scenes[3].text[0].value: TYPE_CARD_LAYOUT at scene "value", text "value-line": too long.',
      '- TYPE_CARD_LAYOUT at scenes[16].text[1].value: TYPE_CARD_LAYOUT at scene "name", text "name-descriptor": too long.',
      '    at prepareFilm (http://localhost:3000/bundle.js:7523:31)',
      '    at async calculateCampaignFilm (http://localhost:3000/bundle.js:8224:16)',
    ].join('\n');
    expect((withPageMessage(error) as Error).message.split('\n')).toEqual([
      'FilmRejected: This campaign cannot be rendered: laying out the copy found 2 error(s).',
      '- TYPE_CARD_LAYOUT at scenes[3].text[0].value: TYPE_CARD_LAYOUT at scene "value", text "value-line": too long.',
      '- TYPE_CARD_LAYOUT at scenes[16].text[1].value: TYPE_CARD_LAYOUT at scene "name", text "name-descriptor": too long.',
    ]);
  });

  it('leaves an error whose message already says everything', () => {
    const error = new Error('Could not find a composition');
    expect((withPageMessage(error) as Error).message).toBe('Could not find a composition');
    expect(withPageMessage('text')).toBe('text');
  });
});
