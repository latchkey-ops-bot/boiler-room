import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_CAP, DEFAULT_IMAGE_MODEL } from '../art/generate.ts';
import { artDirect, defaultOutPath } from '../art/run.ts';
import { freshReport, ledgerPath, recordSpend, refuseUnlessAllowed } from '../pipeline/ledger.ts';

const usage = `Usage: pnpm art <campaign.json> [--research <research.json>] [--out <file>] [--budget-usd 1] [--image-cap-usd 0.10] [--max-images 2] [--image-model <id>] [--concurrency 2] [--max-reviews N] [--no-agent]

  --research       The Researcher's research.json, for the site's light or dark mode and its page kinds.
                   Default: out/research/<host>/research.json when it exists.
  --out            Where the updated campaign goes. Default: <name>.art.json beside the input, with
                   <name>.art.report.json and any generated images under assets/generated/.
  --budget-usd     Spend cap for all of the agent's review sessions for this film. Default 1. Once
                   it is spent no further review starts, and the code's ranking stands.
  --image-cap-usd  Spend cap for generated images in this film. Default ${(DEFAULT_CAP.maxMicroUsd / 1e6).toFixed(2)}.
  --max-images     At most this many generated images in this film. Default ${DEFAULT_CAP.maxImages}.
  --image-model    Default ${DEFAULT_IMAGE_MODEL}.
  --concurrency    Review sessions running at once. Default 2.
  --max-reviews    Review only the first N batches (generated images come first). For a quick check.
  --no-agent       Code only: the default picks, no session and nothing generated.

Exit codes: 0 written, 1 refused (invalid input or result), 3 written but a scene is sent back to the Director.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    research: { type: 'string' },
    out: { type: 'string' },
    'budget-usd': { type: 'string' },
    'image-cap-usd': { type: 'string' },
    'max-images': { type: 'string' },
    'image-model': { type: 'string' },
    concurrency: { type: 'string' },
    'max-reviews': { type: 'string' },
    'no-agent': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

const file = positionals[0];
if (values.help || !file || positionals.length > 1) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

const number = (name: string, raw: string | undefined, min: number, max: number) => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!(value >= min && value <= max)) {
    console.log(`--${name} must be between ${min} and ${max}.`);
    process.exit(1);
  }
  return value;
};

const budget = number('budget-usd', values['budget-usd'], 0.05, 3);
const concurrency = number('concurrency', values.concurrency, 1, 4);
const maxReviews = number('max-reviews', values['max-reviews'], 0, 100);
const imageCap = number('image-cap-usd', values['image-cap-usd'], 0, 1);
const maxImages = number('max-images', values['max-images'], 0, 2);

// pnpm runs this from agents/, so paths are read against the directory pnpm was started in.
const cwd = process.env.INIT_CWD ?? process.cwd();
const campaignPath = resolve(cwd, file);
const outPath = values.out ? resolve(cwd, values.out) : defaultOutPath(campaignPath);
// The film's ledger lives beside its campaign.json: no review starts on a film over its limits.
const film = basename(dirname(campaignPath));
const ledger = ledgerPath(dirname(campaignPath));
refuseUnlessAllowed(ledger, film, 'art-director');
const started = Date.now();
const code = await artDirect({
  campaignPath,
  researchPath: values.research ? resolve(cwd, values.research) : undefined,
  outPath,
  outRoot: fileURLToPath(new URL('../../../out/', import.meta.url)),
  budgetUsd: budget,
  concurrency,
  maxReviews,
  cap: {
    ...DEFAULT_CAP,
    ...(imageCap !== undefined ? { maxMicroUsd: Math.round(imageCap * 1e6) } : {}),
    ...(maxImages !== undefined ? { maxImages } : {}),
  },
  imageModel: values['image-model'] ?? DEFAULT_IMAGE_MODEL,
  agent: !values['no-agent'],
});
const cost = freshReport(`${outPath.replace(/\.json$/, '')}.report.json`, started)?.cost as
  | { session_micro_usd?: number; images_micro_usd?: number }
  | undefined;
if (cost) {
  recordSpend(ledger, film, {
    step: 'art-director',
    microUsd: cost.session_micro_usd ?? 0,
    session: null,
    note: 'review sessions',
  });
  if (cost.images_micro_usd) {
    recordSpend(ledger, film, {
      step: 'art-images',
      microUsd: cost.images_micro_usd,
      session: null,
      note: 'generated images',
    });
  }
}
process.exit(code);
