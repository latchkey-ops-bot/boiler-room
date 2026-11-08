import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_CAP, DEFAULT_IMAGE_MODEL } from '../art/generate.ts';
import { artDirect } from '../art/run.ts';

const usage = `Usage: pnpm art <campaign.json> [--research <research.json>] [--out <file>] [--budget-usd 1] [--image-cap-usd 0.10] [--max-images 2] [--image-model <id>] [--max-repairs 1] [--no-agent]

  --research       The Researcher's research.json, for the site's light or dark mode and its page kinds.
                   Default: out/research/<host>/research.json when it exists.
  --out            Where the updated campaign goes. Default: <name>.art.json beside the input, with
                   <name>.art.report.json and any generated images under assets/generated/.
  --budget-usd     Spend cap for the agent's session. Default from the agent definition ($1, the
                   minimum for Sonnet).
  --image-cap-usd  Spend cap for generated images in this film. Default ${(DEFAULT_CAP.maxMicroUsd / 1e6).toFixed(2)}.
  --max-images     At most this many generated images in this film. Default ${DEFAULT_CAP.maxImages}.
  --image-model    Default ${DEFAULT_IMAGE_MODEL}.
  --max-repairs    Rounds of refused picks sent back to the agent. Default 1.
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
    'max-repairs': { type: 'string', default: '1' },
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

const budget = number('budget-usd', values['budget-usd'], 1, 1.5);
const imageCap = number('image-cap-usd', values['image-cap-usd'], 0, 1);
const maxImages = number('max-images', values['max-images'], 0, 2);

// pnpm runs this from agents/, so paths are read against the directory pnpm was started in.
const cwd = process.env.INIT_CWD ?? process.cwd();
const code = await artDirect({
  campaignPath: resolve(cwd, file),
  researchPath: values.research ? resolve(cwd, values.research) : undefined,
  outPath: values.out ? resolve(cwd, values.out) : undefined,
  outRoot: fileURLToPath(new URL('../../../out/', import.meta.url)),
  budgetUsd: budget,
  maxRepairs: Math.max(0, Number(values['max-repairs'])),
  cap: {
    ...DEFAULT_CAP,
    ...(imageCap !== undefined ? { maxMicroUsd: Math.round(imageCap * 1e6) } : {}),
    ...(maxImages !== undefined ? { maxImages } : {}),
  },
  imageModel: values['image-model'] ?? DEFAULT_IMAGE_MODEL,
  agent: !values['no-agent'],
});
process.exit(code);
