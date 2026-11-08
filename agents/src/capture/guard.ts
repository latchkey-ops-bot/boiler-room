import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Hosts a test build of the tool may load although they resolve to a private address, such as the
 * prompt-injection fixture served on the agent's own loopback. `bundleTool` defines it; the
 * production tool has none, and nothing at run time can add one.
 */
declare const __BR_ALLOW_PRIVATE_HOSTS__: readonly string[] | undefined;

/** Every address a hostname resolves to. */
export type Resolve = (hostname: string) => Promise<string[]>;

const systemResolve: Resolve = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split('.').map(Number);
}

/** The 16 bytes of an IPv6 address, with an embedded dotted IPv4 tail read as its last 4. */
function ipv6Bytes(address: string): number[] | null {
  let text =
    address
      .replace(/^\[|\]$/g, '')
      .split('%')[0]
      ?.toLowerCase() ?? '';
  if (isIP(text) !== 6) return null;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const groups = (part: string) => (part ? part.split(':') : []);
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  const all = [...left, ...fill, ...right];
  if (all.length !== 8) return null;
  return all.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 255];
  });
}

function privateIpv4([a = 0, b = 0]: number[]): string | null {
  if (a === 0) return 'unspecified (0.0.0.0/8)';
  if (a === 127) return 'loopback (127.0.0.0/8)';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
    return 'private (RFC 1918)';
  if (a === 169 && b === 254) return 'link-local (169.254.0.0/16)';
  if (a === 100 && b >= 64 && b <= 127) return 'shared carrier-grade NAT (100.64.0.0/10)';
  return null;
}

/**
 * Why an address must never be fetched, or null for a public one: loopback, unspecified, RFC 1918,
 * link-local and carrier-grade NAT IPv4, and `::1`, `::`, unique-local `fc00::/7` and link-local
 * `fe80::/10` IPv6. An IPv4 address mapped into IPv6 (`::ffff:127.0.0.1`) is judged as the IPv4
 * address it is, since a socket to it reaches that address.
 */
export function privateAddress(address: string): string | null {
  const v4 = ipv4Bytes(address);
  if (v4) return privateIpv4(v4);
  const v6 = ipv6Bytes(address);
  if (!v6) return 'not an IP address';
  const zeros = (from: number, to: number) => v6.slice(from, to).every((byte) => byte === 0);
  if (zeros(0, 10) && v6[10] === 255 && v6[11] === 255) return privateIpv4(v6.slice(12));
  if (zeros(0, 16)) return 'unspecified (::)';
  if (zeros(0, 15) && v6[15] === 1) return 'loopback (::1)';
  const first = v6[0] ?? 0;
  if ((first & 0xfe) === 0xfc) return 'unique local (fc00::/7)';
  if (first === 0xfe && ((v6[1] ?? 0) & 0xc0) === 0x80) return 'link-local (fe80::/10)';
  return null;
}

export interface GuardOptions {
  resolve?: Resolve;
  /** Hostnames that may resolve privately. Only tests and the injection build set any. */
  allowPrivateHosts?: readonly string[];
}

/**
 * Why a URL must not be fetched or loaded, or null when it may be: it must be http(s), and its
 * host must resolve, with every address it resolves to public. A host is checked by what it
 * resolves to, so a name pointed at 127.0.0.1 or the cloud metadata address is refused as well as
 * the bare address.
 */
export async function checkUrl(input: string, options: GuardOptions = {}): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'not a valid address';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'not an http(s) address';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return 'has no host';
  if (options.allowPrivateHosts?.includes(host)) return null;
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await (options.resolve ?? systemResolve)(host);
    } catch {
      return `${host} does not resolve`;
    }
  }
  if (addresses.length === 0) return `${host} does not resolve`;
  for (const address of addresses) {
    const reason = privateAddress(address);
    if (reason) return `${host} resolves to ${address}, a ${reason} address`;
  }
  return null;
}

/** Whether a URL is http(s) on a host that resolves only to public addresses. */
export async function isPublicUrl(input: string, options: GuardOptions = {}): Promise<boolean> {
  return (await checkUrl(input, options)) === null;
}

/**
 * `checkUrl` with each host's answer kept for the life of the process, so a page's hundreds of
 * requests to a few hosts cost a few lookups.
 */
export class UrlGuard {
  private readonly hosts = new Map<string, Promise<string | null>>();
  private readonly options: GuardOptions;
  constructor(options: GuardOptions = {}) {
    this.options = options;
  }
  check(input: string): Promise<string | null> {
    let host: string;
    try {
      const url = new URL(input);
      if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return Promise.resolve('not an http(s) address');
      host = url.host.toLowerCase();
    } catch {
      return Promise.resolve('not a valid address');
    }
    let known = this.hosts.get(host);
    if (!known) {
      known = checkUrl(input, this.options);
      this.hosts.set(host, known);
    }
    return known;
  }
}

const BUILT_IN: readonly string[] =
  typeof __BR_ALLOW_PRIVATE_HOSTS__ === 'undefined' ? [] : __BR_ALLOW_PRIVATE_HOSTS__;

let current = new UrlGuard({ allowPrivateHosts: BUILT_IN });

/** The guard every fetch and page load of the capture tool goes through. */
export function urlGuard(): UrlGuard {
  return current;
}

/** Replaces the guard. Tests use it to load pages from a server on loopback. */
export function configureGuard(options: GuardOptions): void {
  current = new UrlGuard({ allowPrivateHosts: BUILT_IN, ...options });
}

/** The exact hosts font stylesheets are fetched from when the page itself may not read them. */
export function isFontHost(input: string): boolean {
  let host: string;
  try {
    host = new URL(input).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'fonts.googleapis.com' ||
    host === 'fonts.gstatic.com' ||
    host === 'use.typekit.net' ||
    host.endsWith('.typekit.net')
  );
}
