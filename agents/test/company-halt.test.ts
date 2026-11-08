import { describe, expect, it, vi } from 'vitest';
import { HALTED, haltCeo, interruptHeld, isHalted } from '../src/company/halt.ts';
import { syncCompany } from '../src/company/sync.ts';
import type { Naive } from '../src/naive/client.ts';
import { HASH_KEY } from '../src/sync.ts';

/** A fake Naive with one bound br-ceo, its sweep, another agent's deployment, and live sessions. */
function fakeNaive(options: { halted?: boolean } = {}) {
  const org = { id: 'org_1', ceo_agent_id: 'agt_ceo' as string | null };
  const ceo = {
    id: 'agt_ceo',
    name: 'br-ceo',
    current_version: 3,
    budget: options.halted
      ? { cap_micro_usd: 0, max_task_micro_usd: 0, period: 'day' }
      : { cap_micro_usd: 5_000_000, max_task_micro_usd: 1_000_000, period: 'day' },
    metadata: {
      role: 'orchestrator',
      source: 'boiler-room/agents',
      [HASH_KEY]: options.halted ? HALTED : 'abc123',
    },
  };
  const lead = { id: 'agt_lead', name: 'br-eng-lead', current_version: 2, metadata: {} };
  const crew = { id: 'agt_crew', name: 'br-director', current_version: 6, metadata: {} };
  const sessions: Record<string, { id: string; created_at: string }[]> = {
    'agt_ceo/running': [{ id: 'ses_running', created_at: '2026-11-08T01:00:00Z' }],
    'agt_ceo/budget_paused': [{ id: 'ses_paused', created_at: '2026-11-08T01:49:54Z' }],
    'agt_ceo/awaiting_approval': [{ id: 'ses_approval', created_at: '2026-11-08T01:30:00Z' }],
    'agt_lead/budget_paused': [{ id: 'ses_lead_paused', created_at: '2026-11-08T02:00:00Z' }],
    'agt_crew/budget_paused': [{ id: 'ses_crew_paused', created_at: '2026-11-08T02:00:00Z' }],
  };
  const page = <T>(data: T[]) => ({ data, has_more: false, next_cursor: null });
  const client = {
    agents: {
      list: vi.fn(async () => page([ceo, lead, crew])),
      get: vi.fn(async (id: string) => [ceo, lead, crew].find((agent) => agent.id === id)),
      update: vi.fn(async (_id: string, body: Record<string, unknown>) => ({ ...ceo, ...body })),
      delete: vi.fn(async () => {
        org.ceo_agent_id = null;
        return { id: 'agt_ceo', deleted: true, removed_from: [] };
      }),
    },
    deployments: {
      list: vi.fn(async () =>
        page([
          { id: 'dep_sweep', agent_id: 'agt_ceo', enabled: true },
          { id: 'dep_other', agent_id: 'agt_other', enabled: true },
        ]),
      ),
      pause: vi.fn(async (id: string) => ({ id, enabled: false })),
    },
    sessions: {
      list: vi.fn(async (query: { agent_id?: string; status?: string; stop_reason?: string }) =>
        page(
          (sessions[`${query.agent_id}/${query.status ?? query.stop_reason}`] ?? []).map(
            (session) => ({ ...session, deployment_id: null }),
          ),
        ),
      ),
      interrupt: vi.fn(async (id: string) => ({ id })),
    },
    orgs: { list: vi.fn(async () => page([{ ...org }])) },
    skills: { push: vi.fn() },
  };
  const writes = () => [
    ...client.agents.update.mock.calls,
    ...client.agents.delete.mock.calls,
    ...client.deployments.pause.mock.calls,
    ...client.sessions.interrupt.mock.calls,
  ];
  return { client, naive: client as unknown as Naive, org, writes };
}

describe('company:halt', () => {
  it('zeroes the budget first, then pauses the sweep, then interrupts every live br-ceo session', async () => {
    const fake = fakeNaive();
    const report = await haltCeo(fake.naive);
    expect(fake.client.agents.update).toHaveBeenCalledWith('agt_ceo', {
      budget: { cap_micro_usd: 0, max_task_micro_usd: 0, period: 'day' },
      metadata: { role: 'orchestrator', source: 'boiler-room/agents', [HASH_KEY]: HALTED },
      expected_version: 3,
    });
    expect(fake.client.deployments.pause.mock.calls).toEqual([['dep_sweep']]);
    expect(fake.client.sessions.interrupt.mock.calls.map(([id]) => id).sort()).toEqual([
      'ses_approval',
      'ses_paused',
      'ses_running',
    ]);
    const [zeroed] = fake.client.agents.update.mock.invocationCallOrder;
    const [paused] = fake.client.deployments.pause.mock.invocationCallOrder;
    const interrupted = fake.client.sessions.interrupt.mock.invocationCallOrder;
    expect(zeroed).toBeLessThan(paused ?? 0);
    expect(Math.min(...interrupted)).toBeGreaterThan(paused ?? 0);
    expect(report).toMatchObject({ budget: 'zeroed', deleted: false, ceo_agent_id: 'agt_ceo' });
    expect(fake.client.agents.delete).not.toHaveBeenCalled();
  });

  it('leaves ceo_agent_id set: only deleting br-ceo unbinds it', async () => {
    const fake = fakeNaive();
    expect((await haltCeo(fake.naive)).ceo_agent_id).toBe('agt_ceo');
    const unbound = await haltCeo(fakeNaive().naive, () => undefined, { unbind: 'agt_ceo' });
    expect(unbound).toMatchObject({ deleted: true, ceo_agent_id: null });
  });

  it('deletes br-ceo only after it is halted, and only when given its own id', async () => {
    const fake = fakeNaive();
    await haltCeo(fake.naive, () => undefined, { unbind: 'agt_ceo' });
    const [deleted] = fake.client.agents.delete.mock.invocationCallOrder;
    expect(Math.max(...fake.client.sessions.interrupt.mock.invocationCallOrder)).toBeLessThan(
      deleted ?? 0,
    );
    const wrong = fakeNaive();
    await expect(haltCeo(wrong.naive, () => undefined, { unbind: 'agt_lead' })).rejects.toThrow(
      /--unbind names agt_lead, but br-ceo is agt_ceo. Nothing was changed/,
    );
    expect(wrong.writes()).toEqual([]);
  });

  it('changes nothing on a dry run, and says what it would do', async () => {
    const fake = fakeNaive();
    const lines: string[] = [];
    const report = await haltCeo(fake.naive, (line) => lines.push(line), {
      dryRun: true,
      unbind: 'agt_ceo',
    });
    expect(fake.writes()).toEqual([]);
    expect(report).toMatchObject({ dry_run: true, budget: 'would zero', deleted: false });
    expect(report.sweeps).toEqual([{ id: 'dep_sweep', action: 'would pause' }]);
    expect(report.sessions.map((item) => item.action)).toEqual([
      'would interrupt',
      'would interrupt',
      'would interrupt',
    ]);
  });

  it('does not zero a br-ceo that is already halted', async () => {
    const fake = fakeNaive({ halted: true });
    expect((await haltCeo(fake.naive)).budget).toBe('already');
    expect(fake.client.agents.update).not.toHaveBeenCalled();
  });

  it('--held interrupts the held sessions of company agents only, and changes nothing else', async () => {
    const fake = fakeNaive();
    const held = await interruptHeld(fake.naive);
    expect(held.map((session) => session.id).sort()).toEqual([
      'ses_approval',
      'ses_lead_paused',
      'ses_paused',
    ]);
    expect(fake.client.sessions.interrupt.mock.calls.map(([id]) => id)).not.toContain(
      'ses_crew_paused',
    );
    expect(fake.client.sessions.interrupt.mock.calls.map(([id]) => id)).not.toContain(
      'ses_running',
    );
    expect(fake.client.agents.update).not.toHaveBeenCalled();
    expect(fake.client.deployments.pause).not.toHaveBeenCalled();
  });
});

describe('company:sync and a halted br-ceo', () => {
  const unreachable = async (): Promise<never> => {
    throw new Error('stopped after the halt check');
  };

  it('knows a halted br-ceo by its stored hash', () => {
    expect(isHalted({ metadata: { [HASH_KEY]: HALTED } })).toBe(true);
    expect(isHalted({ metadata: { [HASH_KEY]: 'abc123' } })).toBe(false);
    expect(isHalted(null)).toBe(false);
  });

  it('refuses to restore a halted br-ceo unasked, before changing anything', async () => {
    const fake = fakeNaive({ halted: true });
    await expect(
      syncCompany(fake.naive, () => undefined, { catalogue: unreachable, preflight: unreachable }),
    ).rejects.toThrow(/was halted by company:halt, so nothing was changed.*--unhalt/);
    expect(fake.writes()).toEqual([]);
    expect(fake.client.skills.push).not.toHaveBeenCalled();
  });

  it('with --unhalt, interrupts every held br-ceo session before anything restores its budget', async () => {
    const fake = fakeNaive({ halted: true });
    await expect(
      syncCompany(fake.naive, () => undefined, {
        catalogue: unreachable,
        preflight: unreachable,
        unhalt: true,
      }),
    ).rejects.toThrow(/stopped after the halt check/);
    expect(fake.client.sessions.interrupt.mock.calls.map(([id]) => id).sort()).toEqual([
      'ses_approval',
      'ses_paused',
    ]);
    expect(fake.client.agents.update).not.toHaveBeenCalled();
  });

  it('leaves a br-ceo that is not halted to the normal sync', async () => {
    const fake = fakeNaive();
    await expect(
      syncCompany(fake.naive, () => undefined, { catalogue: unreachable, preflight: unreachable }),
    ).rejects.toThrow(/stopped after the halt check/);
    expect(fake.writes()).toEqual([]);
  });
});
