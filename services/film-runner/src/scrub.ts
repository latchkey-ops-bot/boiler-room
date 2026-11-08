/**
 * Takes secrets out of text before it is logged or sent: the run's HMAC key, the Naive key in the
 * env file, and anything shaped like an API key or a bearer token.
 */
import { readFileSync } from 'node:fs';

const PATTERNS = [
  /\bsk_(?:live|test)_[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(NAIVE_[A-Z_]*KEY|[A-Z_]*SECRET[A-Z_]*)=\S+/g,
];

export class Scrubber {
  private readonly secrets: string[];

  constructor(secrets: Array<string | undefined>) {
    this.secrets = secrets.filter((secret): secret is string => !!secret && secret.length >= 8);
  }

  scrub(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join('[REDACTED]');
    for (const pattern of PATTERNS) out = out.replace(pattern, '[REDACTED]');
    return out;
  }
}

/** The Naive key in an env file, read only so it can be scrubbed. Never logged. */
export function naiveKeyIn(envFile: string): string | undefined {
  try {
    const text = readFileSync(envFile, 'utf8');
    return /^(?:export\s+)?NAIVE_API_KEY=["']?([^"'\s]+)/m.exec(text)?.[1];
  } catch {
    return undefined;
  }
}
