/**
 * THE STAND-IN. It makes no film.
 *
 * It takes exactly the arguments the real film command must take (`filmCommandArgs` in
 * `src/contract.ts`), writes the same kinds of events and files, and exits with the same codes, so
 * the runner, the callbacks, the uploads and the website's pause for approval can be built and
 * tested before the film command on `feat/crew-agents` has its `--phase` split and events hook.
 * Nothing in `src/` knows it exists except `src/film-command.ts`, which picks it when the base
 * snapshot was built with `adapter: "standin"`. Delete this folder once the real command is in.
 *
 * What it fakes, and how it says so: every message starts with "Stand-in:". The script is the
 * schema's sample campaign for Nova, unchanged, whatever URL it was given, so it invents no claim
 * about anyone. The videos are labelled test clips ("STAND-IN FILM"). It calls no agent and spends
 * nothing, and its cost events say $0.
 *
 *   node standin/film.ts <url> --phase script|render|all --run-dir <dir> --events <file>
 *     [--approval <file>] [--revise <file>] [--max-usd <n>] [--render local|naive] [--no-sync]
 *
 * `STANDIN_PACE_MS` sets the pause between steps (default 2000), so a film page shows progress.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  type Approval,
  FILM_EXIT,
  type FilmEvent,
  FORMATS,
  type Format,
  PHASES,
  type Phase,
  type Revise,
  type Stage,
  variantKey,
} from '../src/contract.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SAMPLE = fileURLToPath(
  new URL('../../../packages/schema/examples/nova.campaign.json', import.meta.url),
);

interface Campaign {
  id: string;
  durationSeconds: number;
  brand: { name: string };
  claims: Array<{ id: string; status: string; text?: string }>;
  scenes: unknown[];
  variants: { hooks: Array<{ id: string }>; formats: Format[]; ctas: Array<{ id: string }> };
}

class BadInput extends Error {}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    phase: { type: 'string' },
    'run-dir': { type: 'string' },
    events: { type: 'string' },
    approval: { type: 'string' },
    revise: { type: 'string' },
    'max-usd': { type: 'string' },
    render: { type: 'string' },
    'no-sync': { type: 'boolean' },
    'wait-agent': { type: 'string' },
  },
});

const url = positionals[0] ?? '';
const phase = values.phase as Phase;
const runDir = values['run-dir'] ?? '';
const eventsFile = values.events ?? '';
const paceMs = Number(process.env.STANDIN_PACE_MS ?? 2000);

let seq = 0;
let stage: Stage = 'research';

function emit(event: Record<string, unknown>) {
  seq += 1;
  const line = { v: 1, seq, at: new Date().toISOString(), ...event } as unknown as FilmEvent;
  appendFileSync(eventsFile, `${JSON.stringify(line)}\n`);
}

const pause = () => new Promise((resolve) => setTimeout(resolve, paceMs));

function host(): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function enterStage(next: Stage, agent: string, message: string) {
  stage = next;
  emit({ type: 'stage', stage: next, status: 'working', agent, message });
}

function scriptVersion(): number {
  const file = join(runDir, 'script-version');
  return existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) || 0 : 0;
}

function readCampaign(): Campaign {
  return JSON.parse(readFileSync(join(runDir, 'campaign.json'), 'utf8')) as Campaign;
}

async function scriptPhase(revise: Revise | null): Promise<number> {
  if (revise) {
    const current = scriptVersion();
    if (current < 1 || revise.version !== current) {
      throw new BadInput(
        `The note is for version ${revise.version}; the run dir has version ${current}.`,
      );
    }
    enterStage(
      'script',
      'director',
      'Stand-in: no Director ran. The note was read and the sample script kept.',
    );
    await pause();
    const next = current + 1;
    emit({
      type: 'decision',
      agent: 'director',
      stage: 'checks',
      kind: 'decision',
      message: `Stand-in: wrote version ${next}, which is the same sample script.`,
    });
    writeFileSync(join(runDir, 'script-version'), `${next}\n`);
    await pause();
    emit({
      type: 'script_ready',
      version: next,
      campaignPath: 'campaign.json',
      unconfirmedClaims: unconfirmed(readCampaign()),
    });
    return FILM_EXIT.ok;
  }
  const campaign = JSON.parse(readFileSync(SAMPLE, 'utf8')) as Campaign;
  enterStage(
    'research',
    'researcher',
    `Stand-in: no Researcher ran, so ${host()} was not read. A real film starts here.`,
  );
  emit({ type: 'session', agent: 'researcher', sessionId: 'standin-researcher', state: 'started' });
  await pause();
  const research = {
    standIn: true,
    url,
    note: 'The stand-in read nothing. These claims are the sample campaign’s.',
    brand: campaign.brand,
    claims: campaign.claims,
  };
  writeFileSync(join(runDir, 'research.json'), `${JSON.stringify(research, null, 2)}\n`);
  emit({
    type: 'artifact',
    kind: 'research',
    path: 'research.json',
    contentType: 'application/json',
    version: 0,
  });
  emit({
    type: 'decision',
    agent: 'researcher',
    stage: 'research',
    kind: 'decision',
    message: `Stand-in: used the sample campaign for ${campaign.brand.name}, with its ${campaign.claims.length} claims.`,
  });
  emit({ type: 'cost', step: 'researcher', microUsd: 0, totalMicroUsd: 0 });
  emit({
    type: 'session',
    agent: 'researcher',
    sessionId: 'standin-researcher',
    state: 'ended',
    microUsd: 0,
  });
  await pause();
  enterStage(
    'script',
    'director',
    'Stand-in: no Director ran. The sample script stands in for one.',
  );
  await pause();
  emit({
    type: 'decision',
    agent: 'director',
    stage: 'checks',
    kind: 'decision',
    message: `Stand-in: copied the sample script: ${campaign.scenes.length} scenes, ${campaign.durationSeconds} seconds.`,
  });
  emit({ type: 'cost', step: 'director', microUsd: 0, totalMicroUsd: 0 });
  await pause();
  enterStage(
    'checks',
    'validator',
    'Stand-in: no Validator ran. The website checks the script itself when it arrives.',
  );
  writeFileSync(join(runDir, 'campaign.json'), `${JSON.stringify(campaign, null, 2)}\n`);
  writeFileSync(join(runDir, 'script-version'), '1\n');
  await pause();
  emit({
    type: 'script_ready',
    version: 1,
    campaignPath: 'campaign.json',
    unconfirmedClaims: unconfirmed(campaign),
  });
  return FILM_EXIT.ok;
}

function unconfirmed(campaign: Campaign): string[] {
  return campaign.claims.filter((claim) => claim.status !== 'approved').map((claim) => claim.id);
}

function checkApproval(approval: Approval, campaign: Campaign) {
  const version = scriptVersion();
  if (approval.version !== version) {
    throw new BadInput(
      `The approval is for version ${approval.version}; the run dir has version ${version}.`,
    );
  }
  for (const format of approval.formats) {
    if (!FORMATS.includes(format) || !campaign.variants.formats.includes(format)) {
      throw new BadInput(`The script has no ${format} format.`);
    }
  }
  if (
    approval.hookId !== null &&
    !campaign.variants.hooks.some((hook) => hook.id === approval.hookId)
  ) {
    throw new BadInput(`The script has no hook ${approval.hookId}.`);
  }
  if (approval.ctaId !== null && !campaign.variants.ctas.some((cta) => cta.id === approval.ctaId)) {
    throw new BadInput(`The script has no call to action ${approval.ctaId}.`);
  }
}

async function renderPhase(approval: Approval): Promise<number> {
  const campaign = readCampaign();
  checkApproval(approval, campaign);
  const version = approval.version;
  const variants = approval.formats.map((format) =>
    variantKey(format, approval.hookId, approval.ctaId),
  );
  const shapes = approval.formats.join(', ');
  const decisions: Array<{ agent: string; message: string }> = [];
  const decide = (agent: string, stageName: Stage, kind: string, message: string) => {
    decisions.push({ agent, message });
    emit({ type: 'decision', agent, stage: stageName, kind, message });
  };

  enterStage(
    'art_direction',
    'art_director',
    'Stand-in: no Art Director ran. No images were made.',
  );
  await pause();
  decide(
    'art_director',
    'art_direction',
    'decision',
    `Stand-in: kept the sample brand for ${campaign.brand.name}.`,
  );
  emit({ type: 'cost', step: 'art-director', microUsd: 0, totalMicroUsd: 0 });
  await pause();
  enterStage(
    'render',
    'render',
    `Stand-in: no render ran. Copying a labelled test clip for each shape: ${shapes}.`,
  );
  mkdirSync(join(runDir, 'renders'), { recursive: true });
  mkdirSync(join(runDir, 'stills'), { recursive: true });
  mkdirSync(join(runDir, 'quality'), { recursive: true });
  for (const [index, format] of approval.formats.entries()) {
    await pause();
    const key = variants[index] as string;
    const file = `${key.replaceAll(':', 'x')}.mp4`;
    copyFileSync(join(FIXTURES, `${format.replace(':', 'x')}.mp4`), join(runDir, 'renders', file));
    emit({
      type: 'artifact',
      kind: 'mp4',
      path: `renders/${file}`,
      contentType: 'video/mp4',
      version,
      variantKey: key,
    });
    const still = `${format.replace(':', 'x')}-poster.png`;
    copyFileSync(join(FIXTURES, 'still.png'), join(runDir, 'stills', still));
    emit({
      type: 'artifact',
      kind: 'still',
      path: `stills/${still}`,
      contentType: 'image/png',
      version,
    });
  }
  decide(
    'render',
    'render',
    'decision',
    `Stand-in: made ${variants.length} test clip${variants.length === 1 ? '' : 's'}: ${shapes}.`,
  );
  await pause();
  enterStage(
    'review',
    'quality_check',
    'Stand-in: no Quality Check ran. The clips are marked as passed so delivery can be tested.',
  );
  for (const format of approval.formats) {
    const sheet = `contact-sheet-${format.replace(':', 'x')}.png`;
    copyFileSync(join(FIXTURES, 'contact-sheet.png'), join(runDir, 'quality', sheet));
    emit({
      type: 'artifact',
      kind: 'quality',
      path: `quality/${sheet}`,
      contentType: 'image/png',
      version,
    });
    emit({ type: 'qc', format, verdict: 'pass', routable: 0, issues: [] });
  }
  decide(
    'quality_check',
    'review',
    'passed',
    'Stand-in: passed without looking, because no Quality Check ran.',
  );
  writeFileSync(
    join(runDir, 'decisions.json'),
    `${JSON.stringify({ standIn: true, version, decisions }, null, 2)}\n`,
  );
  emit({
    type: 'artifact',
    kind: 'decisions',
    path: 'decisions.json',
    contentType: 'application/json',
    version,
  });
  const manifest = { standIn: true, version, url, approval, variants, campaign: campaign.id };
  writeFileSync(join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  emit({
    type: 'artifact',
    kind: 'manifest',
    path: 'manifest.json',
    contentType: 'application/json',
    version,
  });
  await pause();
  stage = 'delivery';
  emit({ type: 'delivered', version, variants });
  return FILM_EXIT.ok;
}

function readJson<T>(file: string | undefined, what: string): T | null {
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    throw new BadInput(`The ${what} file could not be read.`);
  }
}

async function main(): Promise<number> {
  if (
    !eventsFile ||
    !runDir.startsWith('/') ||
    !PHASES.includes(phase) ||
    !/^https?:\/\//.test(url)
  ) {
    console.error(
      'usage: film.ts <url> --phase script|render|all --run-dir <abs dir> --events <file>',
    );
    return FILM_EXIT.badInput;
  }
  mkdirSync(runDir, { recursive: true });
  process.on('SIGTERM', () => stopped());
  process.on('SIGINT', () => stopped());
  try {
    if (Number(values['max-usd'] ?? '0') < 0) throw new BadInput('--max-usd cannot be negative.');
    if (phase === 'script') return await scriptPhase(readJson<Revise>(values.revise, 'note'));
    if (phase === 'render') {
      const approval = readJson<Approval>(values.approval, 'approval');
      if (!approval) throw new BadInput('--approval is needed for --phase render.');
      return await renderPhase(approval);
    }
    // `all`: a sample film, with no pause for approval.
    await scriptPhase(null);
    const campaign = readCampaign();
    return await renderPhase({
      version: 1,
      hookId: null,
      ctaId: campaign.variants.ctas[0]?.id ?? null,
      formats: ['16:9'],
      confirmedClaimIds: [],
    });
  } catch (error) {
    const bad = error instanceof BadInput;
    emit({
      type: 'error',
      code: bad ? 'bad_input' : 'standin_failed',
      message: `Stand-in: ${error instanceof Error ? error.message : String(error)}`,
      stage,
      retryable: false,
    });
    return bad ? FILM_EXIT.badInput : FILM_EXIT.failed;
  }
}

function stopped() {
  emit({
    type: 'error',
    code: 'stopped',
    message: 'Stand-in: stopped before it finished.',
    stage,
    retryable: false,
  });
  process.exit(FILM_EXIT.stopped);
}

main().then((code) => process.exit(code));
