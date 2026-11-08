import { describe, expect, it } from 'vitest';
import {
  canRunData,
  canSpend,
  cap,
  recordSpend,
  sessionBudget,
  settleSpend,
  spentOn,
} from '../src/gtm/caps.ts';
import { CAPS } from '../src/gtm/config.ts';
import { registrableDomain, sha256 } from '../src/gtm/domain.ts';
import { emptyStore, type LeadRow, setFlag, upgradeStore } from '../src/gtm/store.ts';
import {
  contactedWithin,
  dropReason,
  isSuppressed,
  pruneLeads,
  recordContact,
  suppress,
  suppressedBy,
} from '../src/gtm/suppression.ts';
import { DATE, NOW } from './gtm-fixtures.ts';

const at = NOW.toISOString();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('suppression', () => {
  it('keeps a domain in clear and an address or handle only as a hash of its normal form', () => {
    const store = emptyStore();
    suppress(store, {
      kind: 'email',
      raw: ' Hello@Quillbox.Example ',
      reason: 'opt_out',
      source: 'reply',
      at,
    });
    suppress(store, {
      kind: 'domain',
      raw: 'https://www.quillbox.example/pricing',
      reason: 'removal',
      source: 'remove_form',
      at,
    });
    suppress(store, {
      kind: 'x_handle',
      raw: '@Quillbox_App',
      reason: 'removal',
      source: 'board',
      at,
    });
    expect(store.suppression.map((row) => [row.kind, row.value])).toEqual([
      ['email', sha256('hello@quillbox.example')],
      ['domain', 'quillbox.example'],
      ['x_handle', sha256('quillbox_app')],
    ]);
    expect(JSON.stringify(store.suppression)).not.toContain('hello@');
  });

  it('matches an address by itself and by its domain, and a subdomain by its registrable domain', () => {
    const store = emptyStore();
    suppress(store, {
      kind: 'domain',
      raw: 'quillbox.example',
      reason: 'opt_out',
      source: 'optout_link',
      at,
    });
    expect(isSuppressed(store, { email: 'team@mail.quillbox.example' })).toBe(true);
    expect(isSuppressed(store, { domain: 'https://app.quillbox.example/' })).toBe(true);
    expect(isSuppressed(store, { domain: 'quillbox.co.uk' })).toBe(false);

    const other = emptyStore();
    suppress(other, {
      kind: 'email',
      raw: 'hello@fabrikam.example',
      reason: 'opt_out',
      source: 'reply',
      at,
    });
    expect(suppressedBy(other, { email: 'HELLO@fabrikam.example' })?.reason).toBe('opt_out');
    expect(isSuppressed(other, { email: 'press@fabrikam.example' })).toBe(false);
    expect(isSuppressed(other, { domain: 'fabrikam.example' })).toBe(false);
  });

  it('adds a row once, keeps the first reason, and never removes one', () => {
    const store = emptyStore();
    suppress(store, {
      kind: 'domain',
      raw: 'quillbox.example',
      reason: 'bounce',
      source: 'bounce',
      at,
    });
    suppress(store, {
      kind: 'domain',
      raw: 'www.quillbox.example',
      reason: 'removal',
      source: 'board',
      at,
    });
    expect(store.suppression).toHaveLength(1);
    expect(store.suppression[0]?.reason).toBe('bounce');
  });

  it('survives a store written by an older build, and the high-water mark never falls', () => {
    const store = emptyStore();
    suppress(store, {
      kind: 'domain',
      raw: 'quillbox.example',
      reason: 'opt_out',
      source: 'reply',
      at,
    });
    const upgraded = upgradeStore(
      JSON.parse(JSON.stringify({ ...store, flags: { mode: 'dry_run' } })),
    );
    expect(upgraded.suppression).toHaveLength(1);
    expect(upgraded.flags.rulings.x_policy_accepted).toBe(false);
    expect(upgraded.copy_history).toEqual([]);
  });
});

describe('dedupe', () => {
  it('allows one cold email per domain in any 90 days', () => {
    const store = emptyStore();
    recordContact(store, {
      domain: 'quillbox.example',
      channel: 'email',
      at: daysAgo(89),
      lead_id: 'ld-a',
    });
    expect(contactedWithin(store, 'www.quillbox.example', 'email', NOW)).toBe(true);
    store.contacts[0] = {
      ...(store.contacts[0] as (typeof store.contacts)[number]),
      at: daysAgo(91),
    };
    expect(contactedWithin(store, 'quillbox.example', 'email', NOW)).toBe(false);
  });

  it('allows one X post per domain ever, and one film per domain in 90 days', () => {
    const store = emptyStore();
    recordContact(store, {
      domain: 'quillbox.example',
      channel: 'x_post',
      at: daysAgo(400),
      lead_id: 'ld-a',
    });
    recordContact(store, {
      domain: 'fabrikam.example',
      channel: 'film',
      at: daysAgo(30),
      lead_id: 'ld-b',
    });
    expect(contactedWithin(store, 'quillbox.example', 'x_post', NOW)).toBe(true);
    expect(contactedWithin(store, 'fabrikam.example', 'film', NOW)).toBe(true);
    expect(contactedWithin(store, 'fabrikam.example', 'email', NOW)).toBe(false);
  });

  it('drops a candidate that is suppressed, emailed, filmed, or already a lead today', () => {
    const store = emptyStore();
    suppress(store, { kind: 'domain', raw: 'a.example', reason: 'opt_out', source: 'reply', at });
    recordContact(store, {
      domain: 'b.example',
      channel: 'email',
      at: daysAgo(10),
      lead_id: 'ld-b',
    });
    recordContact(store, {
      domain: 'c.example',
      channel: 'film',
      at: daysAgo(10),
      lead_id: 'ld-c',
    });
    store.leads.push({ id: 'ld-d', domain: 'd.example', date: DATE } as LeadRow);
    expect(dropReason(store, 'a.example', DATE, NOW)).toBe('suppressed');
    expect(dropReason(store, 'b.example', DATE, NOW)).toBe('emailed_90d');
    expect(dropReason(store, 'c.example', DATE, NOW)).toBe('filmed');
    expect(dropReason(store, 'd.example', DATE, NOW)).toBe('lead_today');
    expect(dropReason(store, 'e.example', DATE, NOW)).toBeNull();
  });

  it('drops the address of a lead never contacted after 30 days, and keeps the domain', () => {
    const store = emptyStore();
    const lead = {
      id: 'ld-old',
      domain: 'old.example',
      found_at: daysAgo(31),
      addresses: [
        {
          address: 'hello@old.example',
          source_url: 'https://old.example/',
          page_label: 'homepage',
          provenance: 'site',
        },
      ],
    } as LeadRow;
    const contacted = {
      ...lead,
      id: 'ld-kept',
      addresses: [{ ...lead.addresses[0], address: 'hello@kept.example' }],
    } as LeadRow;
    store.leads.push(lead, contacted);
    recordContact(store, {
      domain: 'kept.example',
      channel: 'email',
      at: daysAgo(31),
      lead_id: 'ld-kept',
    });
    expect(pruneLeads(store, NOW)).toBe(1);
    expect(lead.addresses[0]?.address).toBeNull();
    expect(lead.domain).toBe('old.example');
    expect(contacted.addresses[0]?.address).toBe('hello@kept.example');
  });

  it('reads registrable domains with the public suffix list', () => {
    expect(registrableDomain('https://shop.quillbox.co.uk/a')).toBe('quillbox.co.uk');
    expect(registrableDomain('http://127.0.0.1/')).toBeNull();
  });
});

describe('caps', () => {
  it('lets a flag set a cap anywhere up to its hard maximum, never past it', () => {
    const store = emptyStore();
    expect(cap(store, 'x_posts_day')).toBe(1);
    store.flags.caps.x_posts_day = 3;
    expect(cap(store, 'x_posts_day')).toBe(CAPS.x_posts_day.max);
    store.flags.caps.cold_emails_day = 2;
    expect(cap(store, 'cold_emails_day')).toBe(2);
    store.flags.caps.spend_day_micro = 50_000_000;
    expect(cap(store, 'spend_day_micro')).toBe(10_000_000);
    store.flags.caps.films_day = -4;
    expect(cap(store, 'films_day')).toBe(0);
  });

  it('checks spent today plus the worst case against the day cap, keeping the reply reserve free for films', () => {
    const store = emptyStore();
    recordSpend(store, { date: DATE, category: 'agents', micro_usd: 200_000, ref: 'ses_1' });
    // Five films at $1.00 each, with $1.50 held for replies, fit the $7.00 day.
    for (let film = 0; film < 5; film++) {
      expect(canSpend(store, DATE, 1_000_000, { keepReplyReserve: true }).ok).toBe(true);
      recordSpend(store, {
        date: DATE,
        category: 'films',
        micro_usd: 1_000_000,
        ref: `film-${film}`,
        reserved: true,
      });
    }
    expect(canSpend(store, DATE, 1_000_000, { keepReplyReserve: true })).toEqual({
      ok: false,
      reason: 'day_cap',
    });
    // The reserve is still there for a reply.
    expect(canSpend(store, DATE, 1_000_000).ok).toBe(true);
  });

  it('replaces a film reservation with its reported cost', () => {
    const store = emptyStore();
    recordSpend(store, {
      date: DATE,
      category: 'films',
      micro_usd: 1_000_000,
      ref: 'film:a',
      reserved: true,
    });
    settleSpend(store, 'film:a', 830_000);
    expect(spentOn(store, DATE, 'films')).toBe(830_000);
  });

  it('stops at the month cap whatever today has spent', () => {
    const store = emptyStore();
    recordSpend(store, { date: '2026-11-01', category: 'films', micro_usd: 149_900_000, ref: 'x' });
    expect(canSpend(store, DATE, 200_000)).toEqual({ ok: false, reason: 'month_cap' });
    expect(canSpend(store, '2026-12-01', 200_000).ok).toBe(true);
  });

  it('caps data runs by count and by spend', () => {
    const store = emptyStore();
    store.flags.caps.data_runs_day = 1;
    expect(canRunData(store, DATE, 150).ok).toBe(true);
    store.actions.push({
      key: 'data-run:a',
      kind: 'data-run',
      lead_id: null,
      status: 'sent',
      provider_id: null,
      cost_micro_usd: 150,
      detail: '',
      created_at: `${DATE}T13:00:00Z`,
      executed_at: null,
      planned_ticks: 0,
    });
    expect(canRunData(store, DATE, 150)).toEqual({ ok: false, reason: 'data_runs_cap' });
    const rich = emptyStore();
    recordSpend(rich, { date: DATE, category: 'data', micro_usd: 149_000, ref: 'r' });
    expect(canRunData(rich, DATE, 4_000)).toEqual({ ok: false, reason: 'data_spend_cap' });
  });

  it('raises a session budget to a quote only up to its hard maximum', () => {
    expect(sessionBudget('br-scout')).toEqual({ budget: 150_000, refused: false });
    expect(sessionBudget('br-scout', 250_000)).toEqual({ budget: 250_000, refused: false });
    expect(sessionBudget('br-scout', 400_000)).toEqual({ budget: 150_000, refused: true });
    expect(sessionBudget('br-gtm-lead', 1_000_000).budget).toBe(1_000_000);
  });

  it('audits every flag change', () => {
    const store = emptyStore();
    setFlag(store, 'mode', 'halted', 'gtm:halt', at);
    setFlag(store, 'mode', 'halted', 'gtm:halt', at);
    expect(store.flag_audit).toEqual([
      { at, key: 'mode', from: 'dry_run', to: 'halted', by: 'gtm:halt' },
    ]);
  });
});

describe('bounces and complaints', () => {
  it('suppresses a permanent bounce at once, and pauses the lane only at two in seven days', async () => {
    const { applySenderEvents } = await import('../src/gtm/bounces.ts');
    const store = emptyStore();
    const bounce = (to: string, days: number) => ({
      kind: 'bounce_permanent' as const,
      to,
      at: daysAgo(days),
      messageId: `m-${to}`,
    });
    expect(applySenderEvents(store, [bounce('hello@a.example', 1)], NOW)).toEqual({
      suppressed: 2,
      paused: null,
    });
    expect(isSuppressed(store, { domain: 'a.example' })).toBe(true);
    expect(store.flags.email_paused).toBeNull();
    applySenderEvents(
      store,
      [{ kind: 'bounce_transient', to: 'hello@t.example', at, messageId: 't' }],
      NOW,
    );
    expect(isSuppressed(store, { domain: 't.example' })).toBe(false);
    expect(applySenderEvents(store, [bounce('hello@b.example', 2)], NOW).paused).toBe(
      '2 permanent bounces in 7 days',
    );
    expect(store.flags.email_paused?.reason).toBe('2 permanent bounces in 7 days');
  });

  it('pauses on any complaint', async () => {
    const { applySenderEvents } = await import('../src/gtm/bounces.ts');
    const store = emptyStore();
    const result = applySenderEvents(
      store,
      [{ kind: 'complaint', to: 'hello@c.example', at, messageId: 'c' }],
      NOW,
    );
    expect(result.paused).toBe('a complaint');
    expect(suppressedBy(store, { domain: 'c.example' })?.reason).toBe('complaint');
  });
});
