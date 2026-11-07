/**
 * Moves bytes between this machine and a computer through Naive files, because a computer's `fs`
 * calls take at most 4 MiB each. The bundle goes in as a file the computer downloads from a keyless
 * link, and a chunk comes out through a one-shot upload link the computer sends it to.
 *
 * Neither the API key nor a link ever appears in a command: command history keeps every command and
 * its output for 30 days. A link is written to a file with `fs`, read by the command with `$(cat)`,
 * and deleted by the same command.
 */
import { createHash } from 'node:crypto';
import type { Naive } from './client.ts';
import { runCommand, withRetry } from './exec.ts';

export const UPLOAD_LINK_LIMIT = 60 * 1024 * 1024;

/** Uploads bytes from this machine to a new Naive file through a one-shot link. */
export async function uploadBytes(
  client: Naive,
  name: string,
  contentType: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<string> {
  if (bytes.byteLength > UPLOAD_LINK_LIMIT) {
    throw new Error(`${name} is ${bytes.byteLength} bytes, over the 60 MiB of an upload link.`);
  }
  const ticket = await withRetry(
    () =>
      client.files.createUpload({ name, content_type: contentType, size_bytes: bytes.byteLength }),
    { signal },
  );
  const response = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: new Blob([new Uint8Array(bytes)], { type: contentType }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`Uploading ${name} failed with ${response.status}: ${await response.text()}`);
  }
  return ticket.file_id;
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * A path inside the computer's home, as a command sees it. The `fs` calls name the home as Naive
 * reports it (`/home/naive`), while the shell's `$HOME` can be another directory that `fs` maps to,
 * so commands always go through `$HOME`.
 */
export function inHome(relative: string): string {
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(relative) || relative.includes('..')) {
    throw new Error(`"${relative}" is not a plain path inside the home directory.`);
  }
  return `"$HOME/${relative}"`;
}

/** Writes a link to a file in the computer's home, for one command to read and then delete. */
async function stashLink(client: Naive, computerId: string, home: string, link: string) {
  const relative = `.link-${createHash('sha256').update(link).digest('hex').slice(0, 12)}`;
  await withRetry(() =>
    client.computers.fs(computerId, 'write', { path: `${home}/${relative}`, content: link }),
  );
  return inHome(relative);
}

/** Downloads a Naive file onto the computer at `target`, a path relative to its home. */
export async function fetchOntoComputer(
  client: Naive,
  computerId: string,
  home: string,
  fileId: string,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  const { url } = await withRetry(() => client.files.url(fileId), { signal });
  const link = await stashLink(client, computerId, home, url);
  await runCommand(
    client,
    computerId,
    `set -e; trap 'rm -f ${link}' EXIT; curl -sSfL --retry 3 -o ${inHome(target)} "$(cat ${link})"`,
    { timeoutMs: 300_000, ...(signal ? { signal } : {}) },
  );
}

export interface SentFile {
  fileId: string;
  bytes: number;
  sha256: string;
}

/**
 * Sends a file from the computer, at a path relative to its home, to a new Naive file, then downloads it here and checks its size and
 * hash against what the computer measured. Returns the bytes as they arrived.
 */
export async function sendFromComputer(
  client: Naive,
  computerId: string,
  home: string,
  source: string,
  name: string,
  contentType: string,
  signal?: AbortSignal,
): Promise<SentFile & { content: Uint8Array }> {
  const measured = await runCommand(
    client,
    computerId,
    `stat -c %s ${inHome(source)} && sha256sum ${inHome(source)} | cut -d' ' -f1`,
    { timeoutMs: 60_000, ...(signal ? { signal } : {}) },
  );
  const [sizeLine, hashLine] = measured.stdout.trim().split('\n');
  const bytes = Number(sizeLine);
  const sha256 = (hashLine ?? '').trim();
  if (!Number.isInteger(bytes) || bytes <= 0) throw new Error(`${source} is empty or missing.`);
  if (bytes > UPLOAD_LINK_LIMIT) {
    throw new Error(
      `${source} is ${(bytes / 2 ** 20).toFixed(1)} MiB, over the 60 MiB of an upload link. Use more workers.`,
    );
  }
  const ticket = await withRetry(
    () => client.files.createUpload({ name, content_type: contentType, size_bytes: bytes }),
    { signal },
  );
  const link = await stashLink(client, computerId, home, ticket.upload_url);
  await runCommand(
    client,
    computerId,
    `set -e; trap 'rm -f ${link}' EXIT; curl -sSf --retry 3 -o /dev/null -X PUT -T ${inHome(source)} -H ${quote(`content-type: ${contentType}`)} "$(cat ${link})"`,
    { timeoutMs: 300_000, ...(signal ? { signal } : {}) },
  );
  const content = await withRetry(() => client.files.downloadBytes(ticket.file_id), { signal });
  const got = createHash('sha256').update(content).digest('hex');
  if (content.byteLength !== bytes || got !== sha256) {
    throw new Error(
      `${name} arrived as ${content.byteLength} bytes with hash ${got}, not ${bytes} bytes with ${sha256}.`,
    );
  }
  return { fileId: ticket.file_id, bytes, sha256, content };
}
