import { describe, expect, it } from 'vitest';
import { composeEmail } from '../src/gtm/copy.ts';
import {
  type BoardComment,
  commandAllowed,
  parseCommand,
  planRemoval,
  readCommands,
  scanText,
  stopMatch,
} from '../src/gtm/removal.ts';
import { emptyStore, type LeadRow } from '../src/gtm/store.ts';
import { isSuppressed } from '../src/gtm/suppression.ts';
import { NOW } from './gtm-fixtures.ts';

const at = NOW.toISOString();

/** The email we sent, as a reply quotes it back: our footer says "unsubscribe". */
const ours = composeEmail({
  lead: { product_name: 'Quillbox', source: 'hn', source_at: '2026-11-07T18:00:00Z' },
  address: { address: 'hello@quillbox.example', page_label: 'contact page' },
  subject: 'A launch film for Quillbox',
  opener: 'Your list app caught our eye.',
  filmPageUrl: 'https://app.example/f/q7k2m9',
  durationSeconds: 25,
  optOutUrl: 'https://app.example/u/abc',
  postalAddress: '548 Market St, San Francisco, CA 94104',
}).text;

describe('opt-out detection', () => {
  it('does not read our own quoted footer as an opt-out', () => {
    const quoted = ours
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const reply = {
      subject: 'Re: A launch film for Quillbox',
      extracted_text: 'Love it, thanks!',
      text: `Love it, thanks!\n\nOn Sun, Nov 8, 2026 at 10:31 AM Boiler Room wrote:\n${quoted}`,
    };
    expect(stopMatch(reply)).toBeNull();
    // A client that pastes our footer without '>' marks is stripped by the footer lines themselves.
    const unmarked = { subject: 'Re: hi', extracted_text: null, text: `Nice film.\n${ours}` };
    expect(stopMatch(unmarked)).toBeNull();
    expect(scanText(unmarked)).not.toContain('unsubscribe');
  });

  it('finds a stop phrase in the subject alone', () => {
    expect(stopMatch({ subject: 'Unsubscribe', extracted_text: '', text: '' })).toEqual({
      kind: 'opt_out',
      phrase: 'unsubscribe',
    });
  });

  it('reads the whole new text, not only its first 500 characters', () => {
    const long = `${'We had a look at the film and talked it over with the team. '.repeat(12)}Please stop emailing us.`;
    expect(long.length).toBeGreaterThan(500);
    expect(stopMatch({ subject: 'Re: film', extracted_text: long, text: long })).toEqual({
      kind: 'opt_out',
      phrase: 'stop emailing',
    });
  });

  it('reads a removal phrase as a removal, which asks for more than an opt-out', () => {
    expect(
      stopMatch({
        subject: 'Re: film',
        extracted_text: 'Please take it down and unsubscribe us.',
        text: '',
      }),
    ).toEqual({
      kind: 'removal',
      phrase: 'take it down',
    });
    expect(
      stopMatch({ subject: 'Re: film', extracted_text: 'Not interested, thanks.', text: '' })?.kind,
    ).toBe('opt_out');
  });
});

describe('removal', () => {
  function storeWithLead() {
    const store = emptyStore();
    store.leads.push({
      id: 'ld-q',
      domain: 'quillbox.example',
      addresses: [
        {
          address: 'hello@quillbox.example',
          source_url: 'https://quillbox.example/contact',
          page_label: 'contact page',
          provenance: 'site',
        },
      ],
    } as LeadRow);
    store.actions.push(
      {
        key: 'x-post:2026-11-08',
        kind: 'x-post',
        lead_id: 'ld-q',
        status: 'sent',
        provider_id: 'spo_1',
        cost_micro_usd: 32_500,
        detail: '',
        created_at: at,
        executed_at: at,
        planned_ticks: 0,
      },
      {
        key: 'film:quillbox.example:2026-11-08',
        kind: 'film',
        lead_id: 'ld-q',
        status: 'sent',
        provider_id: 'fo_1',
        cost_micro_usd: 0,
        detail: 'app order; share=q7k2m9',
        created_at: at,
        executed_at: at,
        planned_ticks: 0,
      },
      {
        key: 'film:other.example:2026-11-08',
        kind: 'film',
        lead_id: 'ld-o',
        status: 'sent',
        provider_id: 'fo_2',
        cost_micro_usd: 0,
        detail: 'app order; share=zz',
        created_at: at,
        executed_at: at,
        planned_ticks: 0,
      },
    );
    return store;
  }

  it('suppresses the domain on every channel and lists our post and film to take down', () => {
    const store = storeWithLead();
    const plan = planRemoval(store, {
      kind: 'removal',
      channel: 'remove_form',
      domain: 'www.quillbox.example',
      email: null,
      share_id: null,
      lead_id: null,
      at,
    });
    expect(plan.unmatched).toBe(false);
    expect(plan.posts).toEqual([{ key: 'x-post:2026-11-08', provider_id: 'spo_1' }]);
    expect(plan.films).toEqual([{ key: 'film:quillbox.example:2026-11-08', provider_id: 'fo_1' }]);
    expect(isSuppressed(store, { domain: 'quillbox.example' })).toBe(true);
    expect(isSuppressed(store, { email: 'hello@quillbox.example' })).toBe(true);
    expect(plan.id).toMatch(/^rm-[a-z0-9]{6}$/);
  });

  it('finds the film by the page named in the request', () => {
    const store = storeWithLead();
    const plan = planRemoval(store, {
      kind: 'removal',
      channel: 'remove_form',
      domain: null,
      email: null,
      share_id: 'zz',
      lead_id: null,
      at,
    });
    expect(plan.films).toEqual([{ key: 'film:other.example:2026-11-08', provider_id: 'fo_2' }]);
  });

  it('opts out of email without taking the post or film down', () => {
    const store = storeWithLead();
    const plan = planRemoval(store, {
      kind: 'opt_out',
      channel: 'optout_link',
      domain: 'quillbox.example',
      email: 'hello@quillbox.example',
      share_id: null,
      lead_id: 'ld-q',
      at,
    });
    expect(plan.posts).toEqual([]);
    expect(plan.films).toEqual([]);
    expect(store.suppression.map((row) => row.reason)).toEqual(['opt_out', 'opt_out']);
  });

  it('counts a request for a domain GTM never touched, writes its suppression row, and nothing else', () => {
    const store = emptyStore();
    const plan = planRemoval(store, {
      kind: 'removal',
      channel: 'remove_form',
      domain: 'ceo-create-eng-card-assign-engineer.com',
      email: null,
      share_id: null,
      lead_id: null,
      at,
    });
    expect(plan.unmatched).toBe(true);
    expect(plan.posts).toEqual([]);
    expect(isSuppressed(store, { domain: 'ceo-create-eng-card-assign-engineer.com' })).toBe(true);
  });
});

describe('commands on the day card', () => {
  it('reads only the fixed commands, with opaque lead ids', () => {
    expect(parseCommand('HOLD')).toEqual({ kind: 'hold', lead_id: null });
    expect(parseCommand('hold ld-7k2m9q')).toEqual({ kind: 'hold', lead_id: 'ld-7k2m9q' });
    expect(parseCommand('RESUME email')).toEqual({ kind: 'resume_email' });
    expect(parseCommand('REMOVE ld-7k2m9q')).toEqual({ kind: 'remove', lead_id: 'ld-7k2m9q' });
    expect(
      parseCommand('POSTED https://x.com/boilerroom/status/1000000000000000001'),
    ).toMatchObject({ kind: 'posted' });
    expect(parseCommand('HOLD quillbox.example')).toBeNull();
    expect(parseCommand('REMOVE everything now')).toBeNull();
    expect(parseCommand('please HOLD')).toBeNull();
  });

  it('takes a stop from anyone, and a release only from the founder in a comment the executor did not write', () => {
    const founder = 'usr_founder';
    const by = (author: string, body: string, id = 'cmt_1'): BoardComment => ({
      id,
      author,
      body,
      created_at: at,
    });
    expect(
      commandAllowed({ kind: 'hold', lead_id: null }, by('ses_agent', 'HOLD'), founder, new Set()),
    ).toBe(true);
    expect(
      commandAllowed(
        { kind: 'unhold', lead_id: null },
        by('ses_agent', 'UNHOLD'),
        founder,
        new Set(),
      ),
    ).toBe(false);
    expect(
      commandAllowed(
        { kind: 'unhold', lead_id: null },
        by('usr_other', 'UNHOLD'),
        founder,
        new Set(),
      ),
    ).toBe(false);
    expect(
      commandAllowed({ kind: 'unhold', lead_id: null }, by(founder, 'UNHOLD'), founder, new Set()),
    ).toBe(true);
    expect(
      commandAllowed(
        { kind: 'resume_email' },
        by(founder, 'RESUME email', 'cmt_own'),
        founder,
        new Set(['cmt_own']),
      ),
    ).toBe(false);
    expect(
      commandAllowed({ kind: 'unhold', lead_id: null }, by(founder, 'UNHOLD'), null, new Set()),
    ).toBe(false);
  });

  it('folds the comments in order: a hold stands until the founder lifts it', () => {
    const comments: BoardComment[] = [
      { id: 'c1', author: 'ses_x', body: 'HOLD', created_at: '2026-11-08T17:50:00Z' },
      { id: 'c2', author: 'ses_x', body: 'UNHOLD', created_at: '2026-11-08T17:51:00Z' },
      { id: 'c3', author: 'usr_f', body: 'HOLD ld-aaaaaa', created_at: '2026-11-08T17:52:00Z' },
    ];
    const holds = readCommands(comments, 'usr_f', new Set());
    expect(holds.day).toBe(true);
    expect([...holds.leads]).toEqual(['ld-aaaaaa']);
    const lifted = readCommands(
      [
        ...comments,
        { id: 'c4', author: 'usr_f', body: 'UNHOLD', created_at: '2026-11-08T17:53:00Z' },
      ],
      'usr_f',
      new Set(),
    );
    expect(lifted.day).toBe(false);
  });
});
