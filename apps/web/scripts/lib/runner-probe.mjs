// The runner key's probe: every Naive call the film command makes on a film computer with
// `--phase script|render --render local --no-sync`, made once with the runner's key. Each scope's
// calls are traced to the code that makes them below. Never prints a key.
//
// A call that would spend or change something is made for real only where it costs cents and
// leaves things as they were: a tiny file is uploaded, read and deleted, and br-researcher's
// computer is resumed, runs `echo`, and is paused, as the Researcher leaves it after a film (about
// $0.01, one 10-minute block of a 1 vCPU computer), but only while no session of br-researcher is
// live. A session is never started and an image never generated: those calls are made against an
// id that does not exist, and Naive checks the key's scope before it looks the id up, so a 404 says
// the key may make the call and a 403 says it may not.

import { RUNNER_KEY_SCOPES, scopesMatch } from './runner-secrets.mjs';

/** The crew agent whose computer the film command drives: the Researcher's, for the capture. */
export const RESEARCHER = 'br-researcher';

/**
 * Every Naive call the film command makes with the runner's key, in the order the probe makes
 * them: the probe's name, the scope Naive checks, and where the film command makes it.
 */
export const RUNNER_PROBE_CALLS = [
  { call: 'me', scope: null, where: 'the sync and this probe: what the key may do' },
  { call: 'agents.list', scope: 'agents:read', where: 'checkAgents, before anything is spent' },
  {
    call: 'skills.listVersions',
    scope: 'agents:read',
    where: 'checkAgents: each pinned skill',
  },
  {
    call: 'agents.computer',
    scope: 'computers:write',
    where: 'the Researcher, Director and Art Director reports',
  },
  { call: 'agents.spend', scope: 'billing:read', where: "the Researcher's report" },
  {
    call: 'credits.show',
    scope: 'billing:read',
    where: 'every stage: the balance before and after',
  },
  { call: 'computers.list', scope: 'computers:write', where: "the Researcher's release" },
  { call: 'computers.get', scope: 'computers:write', where: "the Researcher's release" },
  {
    call: 'sessions.list',
    scope: 'sessions:read',
    where: 'liveSessions: who holds the Researcher',
  },
  { call: 'sessions.get', scope: 'sessions:read', where: 'every stage: a turn has settled' },
  { call: 'sessions.stream', scope: 'sessions:read', where: "every stage: the session's events" },
  { call: 'sessions.create', scope: 'sessions:write', where: 'every crew stage' },
  { call: 'sessions.send', scope: 'sessions:write', where: 'repair rounds and nudges' },
  {
    call: 'sessions.interrupt',
    scope: 'sessions:write',
    where: 'closeSession, a time limit, SIGTERM',
  },
  {
    call: 'sessions.cancel',
    scope: 'sessions:write',
    where: 'closeSession: a session parked on its budget',
  },
  {
    call: 'files.list',
    scope: 'files:read',
    where: "the Researcher's capture tool, found by digest",
  },
  {
    call: 'files.upload',
    scope: 'files:write',
    where: 'the capture tool, and the frames Quality Check is shown',
  },
  {
    call: 'files.get',
    scope: 'files:read',
    where: "the Researcher's gate, the Art Director's digests",
  },
  {
    call: 'files.download',
    scope: 'files:read',
    where: 'page evidence, captured pictures, fonts for the copy fit and the render',
  },
  { call: 'files.delete', scope: 'files:write', where: "Quality Check's frames, once reviewed" },
  {
    call: 'computers.resume',
    scope: 'computers:write',
    where: "the Researcher, when br-researcher's computer is paused",
  },
  {
    call: 'computers.exec',
    scope: 'computers:write',
    where: "the Researcher's release: stops the capture",
  },
  { call: 'computers.pause', scope: 'computers:write', where: "the Researcher's release" },
];

/** Not a probe failure: the Art Director goes on with captured pictures when it is refused. */
export const IMAGE_CALL = {
  call: 'media.images',
  scope: 'agents:write',
  where: "the Art Director's generated images",
};

const VERSION = '2026-09-30';
const STOPPED = new Set(['paused', 'destroyed', 'failed']);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs every call in `RUNNER_PROBE_CALLS` once with `key`. Answers each call's result
 * (`how` is `real`, or `scope` when it was made against an id that does not exist), the image
 * generation answer, what was spent by the balance, and whether anything was left changed.
 */
export async function probeRunnerKey(
  key,
  { fetch: get = fetch, baseUrl = 'https://api.vetta.sh', sleep = pause, log = () => {} } = {},
) {
  const results = [];
  const left = [];
  const request = async (method, path, { body, form, accept, idempotent, signal } = {}) => {
    const headers = {
      authorization: `Bearer ${key}`,
      'vetta-version': VERSION,
      accept: accept ?? 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
    };
    const response = await get(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(form ? { body: form } : {}),
      ...(signal ? { signal } : {}),
    });
    return response;
  };
  const json = async (response) => {
    const text = await response.text().catch(() => '');
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const why = (status, body) =>
    `${status}${body?.error?.message ? ` ${String(body.error.message).slice(0, 160)}` : ''}`;
  const record = (call, ok, how, detail) => {
    results.push({ call, ok, how, ...(detail ? { detail } : {}) });
    log(`${ok ? 'ok  ' : 'FAIL'} ${call} (${how})${detail ? `: ${detail}` : ''}`);
    return ok;
  };
  /** A real call that must answer 2xx. Answers the body, or null. */
  const real = async (call, method, path, options) => {
    try {
      const response = await request(method, path, options);
      const body = await json(response);
      record(call, response.ok, 'real', response.ok ? undefined : why(response.status, body));
      return response.ok ? (body ?? {}) : null;
    } catch (error) {
      record(call, false, 'real', String(error).slice(0, 160));
      return null;
    }
  };
  /** A call against an id that does not exist: anything but a 403 (or 401) shows the scope. */
  const scoped = async (call, method, path, body, detail) => {
    try {
      const response = await request(method, path, { body, idempotent: true });
      const answer = await json(response);
      const refused = response.status === 401 || response.status === 403;
      return record(
        call,
        !refused,
        'scope',
        refused ? why(response.status, answer) : `${response.status}${detail ? `, ${detail}` : ''}`,
      );
    } catch (error) {
      return record(call, false, 'scope', String(error).slice(0, 160));
    }
  };

  try {
    const response = await request('GET', '/v1/me');
    const me = await json(response);
    const exact = response.ok && scopesMatch(me?.scopes, RUNNER_KEY_SCOPES);
    record(
      'me',
      exact,
      'real',
      response.ok
        ? exact
          ? undefined
          : `holds ${(me?.scopes ?? []).join(', ') || 'nothing'}`
        : why(response.status, me),
    );
  } catch (error) {
    record('me', false, 'real', String(error).slice(0, 160));
  }
  const balanceBefore = (await real('credits.show', 'GET', '/v1/credits/balance'))
    ?.balance_micro_usd;

  const agents = await real('agents.list', 'GET', '/v1/agents?limit=100');
  const researcher = agents?.data?.find((agent) => agent.name === RESEARCHER);
  const pinned = researcher?.skills?.[0]?.split('@')[0] ?? 'site-research';
  await real(
    'skills.listVersions',
    'GET',
    `/v1/skills/${encodeURIComponent(pinned)}/versions?limit=100`,
  );

  let computer = null;
  let busy = true;
  if (researcher) {
    const id = encodeURIComponent(researcher.id);
    const found = await real('agents.computer', 'GET', `/v1/agents/${id}/computer`);
    computer = found?.id ? found : null;
    await real('agents.spend', 'GET', `/v1/agents/${id}/spend?by=component`);
    const live = [];
    let listed = true;
    for (const status of ['running', 'queued']) {
      const page = await request(
        'GET',
        `/v1/sessions?agent_id=${id}&status=${status}&limit=100`,
      ).catch(() => null);
      const body = page ? await json(page) : null;
      if (!page?.ok) listed = false;
      for (const session of body?.data ?? []) live.push(session.id);
    }
    record('sessions.list', listed, 'real', live.length ? `${live.length} live` : undefined);
    busy = !listed || live.length > 0;
    // The most recent session of the Researcher, to read as a stage reads its own.
    const recent = await request('GET', `/v1/sessions?agent_id=${id}&limit=1`).catch(() => null);
    const last = recent?.ok ? (await json(recent))?.data?.[0] : undefined;
    if (last) {
      const session = await real(
        'sessions.get',
        'GET',
        `/v1/sessions/${encodeURIComponent(last.id)}`,
      );
      await stream(last.id, Math.max(0, (session?.last_seq ?? 1) - 1));
    } else {
      await scoped('sessions.get', 'GET', '/v1/sessions/ses_keyprobe', undefined, 'no session yet');
      await scoped('sessions.stream', 'GET', '/v1/sessions/ses_keyprobe/stream?after_seq=0');
    }
  } else {
    record('agents.computer', false, 'real', `no agent named ${RESEARCHER}`);
    for (const call of ['agents.spend', 'sessions.list', 'sessions.get', 'sessions.stream'])
      record(call, false, 'real', `no agent named ${RESEARCHER}`);
  }

  async function stream(sessionId, afterSeq) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await request(
        'GET',
        `/v1/sessions/${encodeURIComponent(sessionId)}/stream?after_seq=${afterSeq}`,
        { accept: 'text/event-stream', signal: controller.signal },
      );
      if (!response.ok) {
        record('sessions.stream', false, 'real', why(response.status, await json(response)));
        return;
      }
      const reader = response.body?.getReader();
      let text = '';
      while (reader && !/^data:/m.test(text)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += new TextDecoder().decode(chunk.value);
      }
      await reader?.cancel().catch(() => undefined);
      record('sessions.stream', true, 'real', /^data:/m.test(text) ? 'an event' : 'no event');
    } catch (error) {
      record('sessions.stream', controller.signal.aborted, 'real', 'no event in 15 s');
      if (!controller.signal.aborted) results.at(-1).detail = String(error).slice(0, 160);
    } finally {
      clearTimeout(timer);
    }
  }

  await real('computers.list', 'GET', '/v1/computers?limit=100');
  if (computer)
    await real('computers.get', 'GET', `/v1/computers/${encodeURIComponent(computer.id)}`);
  else await scoped('computers.get', 'GET', '/v1/computers/cmp_keyprobe', undefined, 'no computer');

  // Sessions: never started, so nothing is spent. The scope is checked before the ids are.
  await scoped(
    'sessions.create',
    'POST',
    '/v1/sessions',
    { agent_id: 'agt_keyprobe', message: 'keyprobe', budget_micro_usd: 1 },
    'no such agent',
  );
  await scoped('sessions.send', 'POST', '/v1/sessions/ses_keyprobe/messages', {
    message: 'keyprobe',
    queue: true,
  });
  await scoped('sessions.interrupt', 'POST', '/v1/sessions/ses_keyprobe/interrupt', {});
  await scoped('sessions.cancel', 'POST', '/v1/sessions/ses_keyprobe/cancel', {});

  // Files: one tiny file, uploaded, read back and deleted, as Quality Check does with its frames.
  await real('files.list', 'GET', '/v1/files?search=br-research&limit=10');
  const form = new FormData();
  const content = `Boiler Room runner key probe ${new Date().toISOString()}\n`;
  form.append('file', new Blob([content], { type: 'text/plain' }), 'keyprobe.txt');
  form.append('title', `br-keyprobe ${Date.now()}`);
  form.append('tags', 'boiler-room,keyprobe');
  form.append('folder', 'Boiler Room tools');
  const uploaded = await real('files.upload', 'POST', '/v1/files', { form });
  if (uploaded?.id) {
    const fileId = encodeURIComponent(uploaded.id);
    left.push(`file ${uploaded.id}`);
    await real('files.get', 'GET', `/v1/files/${fileId}`);
    try {
      const response = await request('GET', `/v1/files/${fileId}?download=true`, {
        accept: '*/*',
      });
      const same = response.ok && (await response.text()) === content;
      record(
        'files.download',
        same,
        'real',
        response.ok ? (same ? undefined : 'other bytes') : `${response.status}`,
      );
    } catch (error) {
      record('files.download', false, 'real', String(error).slice(0, 160));
    }
    if (await real('files.delete', 'DELETE', `/v1/files/${fileId}`)) left.pop();
  } else {
    for (const call of ['files.get', 'files.download', 'files.delete'])
      record(call, false, 'real', 'nothing was uploaded');
  }

  // br-researcher's computer, as the Researcher drives it: resumed if paused, `echo` (as its
  // release runs pkill), then paused. Only while none of its sessions is live.
  if (computer && !busy) {
    const id = encodeURIComponent(computer.id);
    const status = async () =>
      (await json(await request('GET', `/v1/computers/${id}`)))?.status ?? 'unknown';
    const until = async (wanted, ms = 120_000) => {
      for (let waited = 0; waited < ms; waited += 3000) {
        const now = await status();
        if (wanted.includes(now)) return now;
        await sleep(3000);
      }
      return status();
    };
    let ran = computer.status === 'running';
    if (computer.status === 'paused') {
      if (await real('computers.resume', 'POST', `/v1/computers/${id}/resume`, { body: {} })) {
        left.push(`computer ${computer.id} running`);
        ran = (await until(['running'])) === 'running';
      }
    } else {
      await scoped(
        'computers.resume',
        'POST',
        '/v1/computers/cmp_keyprobe/resume',
        {},
        'it was running',
      );
    }
    if (ran) {
      const exec = await real('computers.exec', 'POST', `/v1/computers/${id}/exec`, {
        body: { command: 'echo keyprobe', timeout_ms: 20_000 },
      });
      if (exec && !String(exec.stdout ?? '').includes('keyprobe')) {
        results.at(-1).ok = false;
        results.at(-1).detail = `exit ${exec.exit_code}`;
      }
    } else {
      record('computers.exec', false, 'real', 'the computer did not come up');
    }
    // A computer that was just used is refused for a few minutes ("try again when it rests"), so
    // the pause is asked for every 15 s for up to 8 minutes, as the Researcher's release does.
    let paused = false;
    const tries = 32;
    for (let attempt = 0; attempt < tries && !paused; attempt++) {
      const response = await request('POST', `/v1/computers/${id}/pause`, { body: {} });
      const body = await json(response);
      if (response.ok) {
        paused = true;
        record('computers.pause', true, 'real', attempt ? `after ${attempt * 15} s` : undefined);
      } else if (response.status === 401 || response.status === 403 || attempt === tries - 1) {
        record('computers.pause', false, 'real', why(response.status, body));
        break;
      } else {
        if (attempt === 0) log(`     computers.pause: ${why(response.status, body)}; asking again`);
        await sleep(15_000);
      }
    }
    if (paused && STOPPED.has(await until(['paused', 'destroyed', 'failed']))) {
      const at = left.indexOf(`computer ${computer.id} running`);
      if (at >= 0) left.splice(at, 1);
    }
  } else {
    const reason = computer ? `${RESEARCHER} has a live session` : `${RESEARCHER} has no computer`;
    for (const [call, path, body] of [
      ['computers.resume', '/v1/computers/cmp_keyprobe/resume', {}],
      ['computers.exec', '/v1/computers/cmp_keyprobe/exec', { command: 'true' }],
      ['computers.pause', '/v1/computers/cmp_keyprobe/pause', {}],
    ])
      await scoped(call, 'POST', path, body, `not run for real: ${reason}`);
  }

  // Image generation, with a model that does not exist, so it never spends: 400 means the key
  // may generate images, 403 that the Art Director goes on with captured pictures.
  let images;
  try {
    const response = await request('POST', '/v1/media/images', {
      body: { model: 'br-keyprobe/no-such-model', prompt: 'keyprobe', n: 1 },
      idempotent: true,
    });
    const body = await json(response);
    images = {
      ...IMAGE_CALL,
      status: response.status,
      available: response.status !== 401 && response.status !== 403,
      detail: why(response.status, body),
    };
  } catch (error) {
    images = { ...IMAGE_CALL, status: null, available: null, detail: String(error).slice(0, 160) };
  }

  const after = await request('GET', '/v1/credits/balance').catch(() => null);
  const balanceAfter = after?.ok ? (await json(after))?.balance_micro_usd : undefined;
  const missing = RUNNER_PROBE_CALLS.filter(
    ({ call }) => !results.some((result) => result.call === call && result.ok),
  ).map(({ call }) => call);
  return {
    results,
    images,
    missing,
    left,
    // The whole organization's balance: another agent's spend meanwhile shows here too.
    balanceDeltaMicroUsd:
      typeof balanceBefore === 'number' && typeof balanceAfter === 'number'
        ? balanceBefore - balanceAfter
        : null,
  };
}
