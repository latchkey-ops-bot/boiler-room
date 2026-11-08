import { describe, expect, it, vi } from 'vitest';
import { controlPlaneTool, unnamedOn } from '../src/company/control-plane.ts';
import { CONTROL_PLANE_TOOLS } from '../src/company/control-plane-tools.ts';
import {
  boardExposure,
  boardOffered,
  exposureLine,
  intendedBoardTools,
  liveBoardExposure,
} from '../src/company/seats.ts';
import { verifyLockdown } from '../src/company/verify.ts';
import { ceo, company } from '../src/definitions/company/index.ts';
import { researcher } from '../src/definitions/index.ts';
import type { Naive } from '../src/naive/client.ts';

const OFF = { enabled: false, permission: 'deny' } as const;
const ALLOW = { enabled: true, permission: 'allow' } as const;

/** A crew agent as the crew branches sync it today: deny by default, neither board tool named. */
const unnamedCrew = (name: string, id: string, version = 6) => ({
  name,
  id,
  current_version: version,
  tools: { default_config: { permission: 'deny' }, configs: { bash: ALLOW } },
});

describe('the company board', () => {
  it('offers a seated agent a board tool unless the tool is named off, even under a deny default', () => {
    expect(boardOffered({}, 'board_write')).toBe(true);
    expect(boardOffered({ board_write: { permission: 'ask' } }, 'board_write')).toBe(true);
    expect(boardOffered({ board_write: OFF }, 'board_write')).toBe(false);
    expect(
      boardOffered({ board_write: { enabled: true, permission: 'deny' } }, 'board_write'),
    ).toBe(false);
    expect(boardOffered({ board_write: { enabled: false } }, 'board_write')).toBe(false);
  });

  it('means only br-ceo and the builders to use the board, and no one else', () => {
    for (const name of ['br-ceo', 'br-eng-lead', 'br-engineer-1', 'br-product', 'br-design']) {
      expect(intendedBoardTools(name), name).toEqual(['board_read', 'board_write']);
    }
    for (const name of [
      'br-gtm-lead',
      'br-scout',
      'br-social',
      'br-inbox-reader',
      'br-researcher',
      'br-director',
      'br-probe-x',
    ]) {
      expect(intendedBoardTools(name), name).toEqual([]);
    }
  });

  it('exposes nothing with the toolsets this repo defines', () => {
    const stored = [...company, researcher].map((definition, index) => ({
      name: definition.name,
      id: `agt_${index}`,
      current_version: 1,
      tools: definition.tools,
    }));
    expect(boardExposure(stored)).toEqual([]);
  });

  it('flags the crew and Researcher agents other branches synced, and a company agent that lost its off', () => {
    const gtm = company.find((agent) => agent.name === 'br-gtm-lead');
    if (!gtm) throw new Error('br-gtm-lead is not defined');
    const { board_write: _dropped, ...gtmConfigs } = gtm.tools.configs;
    const exposure = boardExposure([
      unnamedCrew('br-director', 'agt_0nj2ttrmyya7chj8sfwkwj9jzr'),
      unnamedCrew('br-art-director', 'agt_qbd0kmts4ecefyt18kreeb47z5'),
      unnamedCrew('br-quality-check', 'agt_8k2bdprp50cwqz1dz7r29n5ts2', 1),
      unnamedCrew('br-researcher', 'agt_9nfk2k2v3q2w9p5p28dcms3xg2', 1),
      { name: 'br-ceo', id: 'agt_ceo', current_version: 3, tools: ceo.tools },
      { name: 'br-gtm-lead', id: 'agt_gtm', current_version: 2, tools: { configs: gtmConfigs } },
      {
        name: 'br-probe-seat',
        id: 'agt_probe',
        current_version: 1,
        tools: { configs: { board_write: OFF } },
      },
    ]);
    expect(exposure.map((item) => [item.name, item.offered])).toEqual([
      ['br-art-director', ['board_read', 'board_write']],
      ['br-director', ['board_read', 'board_write']],
      ['br-gtm-lead', ['board_write']],
      ['br-probe-seat', ['board_read']],
      ['br-quality-check', ['board_read', 'board_write']],
      ['br-researcher', ['board_read', 'board_write']],
    ]);
    expect(exposureLine(exposure[1] as (typeof exposure)[number])).toBe(
      'br-director agt_0nj2ttrmyya7chj8sfwkwj9jzr v6 is seated on the company board and offered board_read and board_write. Its definition must name both off (toolset() in src/define.ts names both), then sync it.',
    );
  });

  it('reads every agent in the organization as Naive stores it, and writes nothing', async () => {
    const agents = [
      unnamedCrew('br-director', 'agt_dir'),
      { ...unnamedCrew('br-ceo', 'agt_ceo'), tools: ceo.tools },
    ];
    const client = {
      agents: {
        list: vi.fn(async () => ({ data: agents, has_more: false, next_cursor: null })),
        get: vi.fn(async (id: string) => agents.find((agent) => agent.id === id)),
        update: vi.fn(),
      },
    };
    const exposure = await liveBoardExposure(client as unknown as Naive);
    expect(exposure.map((item) => item.name)).toEqual(['br-director']);
    expect(client.agents.get).toHaveBeenCalledTimes(2);
    expect(client.agents.update).not.toHaveBeenCalled();
  });
});

describe('the control plane on br-ceo as stored', () => {
  it('names every served tool off with the toolset this repo defines', () => {
    expect(unnamedOn(CONTROL_PLANE_TOOLS, ceo.tools.configs)).toEqual([]);
  });

  it('catches a tool Naive added after the last sync, and a stored toolset behind the repo', () => {
    expect(unnamedOn([...CONTROL_PLANE_TOOLS, 'agents_clone'], ceo.tools.configs)).toEqual([
      'agents_clone',
    ]);
    const { [controlPlaneTool('agents_create')]: _gone, ...behind } = ceo.tools.configs;
    expect(unnamedOn(CONTROL_PLANE_TOOLS, behind)).toEqual(['agents_create']);
    expect(
      unnamedOn(['agents_create'], { [controlPlaneTool('agents_create')]: { permission: 'ask' } }),
    ).toEqual(['agents_create']);
  });
});

describe('company:verify --lockdown', () => {
  function fake(agents: { name: string; id: string; current_version: number; tools: unknown }[]) {
    return {
      agents: {
        list: vi.fn(async () => ({ data: agents, has_more: false, next_cursor: null })),
        get: vi.fn(async (id: string) => agents.find((agent) => agent.id === id)),
      },
      sessions: { create: vi.fn() },
    };
  }
  const bound = { name: 'br-ceo', id: 'agt_ceo', current_version: 3, tools: ceo.tools };

  it('passes when no agent is exposed and br-ceo names the whole catalogue off, with no session', async () => {
    const client = fake([bound]);
    const result = await verifyLockdown(client as unknown as Naive, async () => [
      ...CONTROL_PLANE_TOOLS,
    ]);
    expect(result.verdict).toEqual({ ok: true, failures: [] });
    expect(client.sessions.create).not.toHaveBeenCalled();
  });

  it('fails on an exposed agent and on a served tool br-ceo does not name', async () => {
    const client = fake([bound, unnamedCrew('br-director', 'agt_dir')]);
    const result = await verifyLockdown(client as unknown as Naive, async () => [
      ...CONTROL_PLANE_TOOLS,
      'agents_clone',
    ]);
    expect(result.verdict.ok).toBe(false);
    expect(result.exposure.map((item) => item.name)).toEqual(['br-director']);
    expect(result.unnamed_on_ceo).toEqual(['agents_clone']);
    expect(result.verdict.failures).toEqual([
      expect.stringMatching(/^br-director agt_dir v6 is seated on the company board/),
      expect.stringMatching(/^br-ceo is offered 1 control-plane tool\(s\) at "ask".*agents_clone/),
    ]);
  });
});
