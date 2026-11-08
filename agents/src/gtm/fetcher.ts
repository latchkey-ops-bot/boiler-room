import { DISCOVERY } from './config.ts';

/**
 * Fetching untrusted URLs. Every site GTM reads, and every `t.co` link it resolves, is chosen by
 * someone outside the company, so the fetcher allows only http and https on ports 80 and 443,
 * resolves each host and refuses loopback, private, link-local, CGNAT and other special addresses
 * on every redirect hop, follows at most 5 redirects, and reads at most 300 KB in 8 s. No browser,
 * no cookies, no forms.
 */

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Whether the body was cut at `maxBytes`. */
  truncated: boolean;
}

/**
 * Makes one request with no redirect following. The Node transport also checks every address it
 * connects to, which closes the gap between resolving a host and connecting to it.
 */
export interface Transport {
  get(
    url: string,
    options: { headers: Record<string, string>; timeoutMs: number; maxBytes: number },
  ): Promise<RawResponse>;
  /** Every address a host resolves to. */
  resolve(host: string): Promise<string[]>;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  truncated: boolean;
  /** Each address the request passed through, the first included. */
  hops: string[];
}

export class FetchRefused extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const v4 = (address: string): number[] | null => {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return numbers.every((value) => value >= 0 && value <= 255) ? numbers : null;
};

function v4Special(octets: number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Expands an IPv6 address to eight 16-bit groups, or null if it is not one. */
function v6Groups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/g, '');
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(':')) return null;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const octets = v4(last);
    if (!octets) return null;
    tail = [((octets[0] ?? 0) << 8) | (octets[1] ?? 0), ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)];
    // Keep a "::" that ends right before the IPv4 part; drop a single trailing ":".
    text = text.slice(0, lastColon + 1);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === ''
      ? []
      : part
          .split(':')
          .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const fill = 8 - head.length - rest.length - tail.length;
  if (halves.length === 1 && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? fill : 0).fill(0), ...rest, ...tail];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

/** Whether an address is loopback, private, link-local, CGNAT, multicast, documentation or reserved. */
export function isSpecialAddress(address: string): boolean {
  const octets = v4(address);
  if (octets) return v4Special(octets);
  const groups = v6Groups(address);
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const embedded = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
  if (groups.every((group) => group === 0)) return true; // ::
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return true; // ::1
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return v4Special(embedded); // IPv4-mapped and IPv4-compatible
  }
  if (g0 === 0x64 && g1 === 0xff9b) return v4Special(embedded); // NAT64
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return v4Special([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255]); // 6to4
  return false;
}

/** Checks a URL's scheme, port and host before any request. */
export async function checkTarget(url: string, transport: Transport): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchRefused('bad_url', `not a URL: ${url.slice(0, 80)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchRefused('scheme', `scheme ${parsed.protocol} is not allowed`);
  }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    throw new FetchRefused('port', `port ${parsed.port} is not allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new FetchRefused('credentials', 'URLs with credentials are not fetched');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new FetchRefused('host', `host ${host} is not allowed`);
  }
  const literal = v4(host) ?? v6Groups(host);
  const addresses = literal ? [host] : await transport.resolve(host).catch(() => []);
  if (!addresses.length) throw new FetchRefused('dns', `${host} did not resolve`);
  const special = addresses.find(isSpecialAddress);
  if (special) throw new FetchRefused('address', `${host} resolves to a non-public address`);
  return parsed;
}

/** The target of an HTML meta refresh or a `location.replace(...)`, as `t.co` answers scripts. */
export function scriptRedirect(body: string): string | null {
  const meta =
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=([^"'>]+)["']/i.exec(body) ??
    /<meta[^>]+content=["'][^"']*?url=([^"'>]+)["'][^>]*http-equiv=["']?refresh/i.exec(body);
  if (meta?.[1]) return decodeEntities(meta[1].trim());
  const script = /location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/.exec(body);
  if (script?.[1]) return script[1].replace(/\\\//g, '/');
  return null;
}

const decodeEntities = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/');

export interface FetchOptions {
  userAgent: string;
  /** Also follow a meta refresh or `location.replace` target, as for `t.co`. */
  followScriptRedirects?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
}

/** Fetches a URL under the rules above, following redirects one checked hop at a time. */
export async function safeFetch(
  url: string,
  transport: Transport,
  options: FetchOptions,
): Promise<FetchResult> {
  const hops: string[] = [];
  let current = url;
  for (let redirect = 0; ; redirect++) {
    if (redirect > DISCOVERY.max_redirects) {
      throw new FetchRefused('redirects', `more than ${DISCOVERY.max_redirects} redirects`);
    }
    const target = await checkTarget(current, transport);
    hops.push(target.toString());
    const response = await transport.get(target.toString(), {
      headers: {
        'user-agent': options.userAgent,
        accept: 'text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.5',
      },
      timeoutMs: options.timeoutMs ?? DISCOVERY.page_timeout_ms,
      maxBytes: options.maxBytes ?? DISCOVERY.page_max_bytes,
    });
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, target).toString();
      continue;
    }
    if (options.followScriptRedirects && response.status === 200) {
      const next = scriptRedirect(response.body);
      if (next) {
        current = new URL(next, target).toString();
        continue;
      }
    }
    return {
      url,
      finalUrl: target.toString(),
      status: response.status,
      contentType: response.headers['content-type'] ?? null,
      body: response.body,
      truncated: response.truncated,
      hops,
    };
  }
}

/** Whether robots.txt lets `agent` fetch `path`: the longest matching Allow or Disallow wins. */
export function robotsAllows(robots: string, agent: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      if (field === 'disallow' && value === '') continue;
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const name = agent.toLowerCase().split('/')[0] ?? '';
  const specific = groups.filter((group) =>
    group.agents.some((item) => item !== '*' && name.includes(item)),
  );
  const chosen = specific.length ? specific : groups.filter((group) => group.agents.includes('*'));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of chosen.flatMap((group) => group.rules)) {
    const pattern = rule.path
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$');
    if (!new RegExp(`^${pattern}`).test(path)) continue;
    if (
      !best ||
      rule.path.length > best.length ||
      (rule.path.length === best.length && rule.allow)
    ) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }
  return best ? best.allow : true;
}
