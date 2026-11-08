#!/usr/bin/env node
// Checks a deployed Worker: `node scripts/smoke.mjs <url>`, or `pnpm web:smoke <url>`.
// Exits 1 when any check fails. Run it after every deploy and every rollback.
import { fail } from './lib/env.mjs';

/** What every healthy deploy answers. Each check names what it proves. */
export async function smoke(baseUrl, { expectVersion } = {}) {
  const base = baseUrl.replace(/\/$/, '');
  const results = [];
  const check = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail });
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const get = (path, init) =>
    fetch(`${base}${path}`, { redirect: 'manual', ...init, signal: AbortSignal.timeout(20_000) });

  await check('GET /api/health answers ok, with D1 up', async () => {
    const response = await get('/api/health');
    const body = await response.json();
    if (response.status !== 200 || body.ok !== true) {
      throw new Error(`status ${response.status}, body ${JSON.stringify(body)}`);
    }
    if (expectVersion && body.version !== expectVersion) {
      throw new Error(`version ${body.version}, expected ${expectVersion}`);
    }
    return `env ${body.env}, version ${body.version}, pipeline ${body.pipeline}`;
  });
  await check('GET / renders the landing page', async () => {
    const response = await get('/');
    const html = await response.text();
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    if (!html.includes('Get your launch video')) throw new Error('the hero headline is missing');
    return 'status 200';
  });
  await check('GET /showcase renders', async () => {
    const response = await get('/showcase');
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    return 'status 200';
  });
  await check('GET /api/films refuses a signed-out caller', async () => {
    const response = await get('/api/films');
    if (response.status !== 401) throw new Error(`status ${response.status}, expected 401`);
    return 'status 401';
  });
  await check('GET /films sends a signed-out visitor to sign in', async () => {
    const response = await get('/films');
    const location = response.headers.get('location') ?? '';
    if (response.status < 300 || response.status >= 400 || !location.includes('sign-in')) {
      throw new Error(`status ${response.status}, location ${location || 'none'}`);
    }
    return `status ${response.status}`;
  });

  for (const result of results) {
    console.log(`${result.ok ? '✓' : '✗'} ${result.name}: ${result.detail}`);
  }
  return results.every((result) => result.ok);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) fail('Usage: node scripts/smoke.mjs <https://worker-url>');
  const ok = await smoke(url);
  if (!ok) fail('Smoke check failed.');
  console.log('\nSmoke check passed.');
}
