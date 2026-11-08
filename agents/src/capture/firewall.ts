import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { connect, isIP } from 'node:net';
import { privateAddress } from './guard.ts';

/**
 * The capture's egress firewall, on the agent's own computer. The address guard checks what a host
 * resolves to, but Chromium and Playwright's fetcher resolve the name again themselves, so a hostile
 * site can answer the guard with a public address and the browser with a private one (DNS
 * rebinding). These rules refuse every new connection to a private range at the network layer,
 * whatever name led to it, and the guard stays as the second layer.
 *
 * The computer's harness reaches the machine over vsock, which netfilter never sees, and its inbound
 * listeners (ttyd, sshd) get their replies through the conntrack rule, so the rules leave it alone.
 */

/** The chain that holds the rules; `OUTPUT` jumps to it first. */
export const CHAIN = 'BR_EGRESS';

/** IPv4 ranges no connection may reach. Loopback stays open: Playwright drives Chromium through it. */
export const BLOCKED_IPV4: readonly string[] = [
  '169.254.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '0.0.0.0/8',
  '224.0.0.0/4',
];

/** IPv6 ranges no connection may reach. */
export const BLOCKED_IPV6: readonly string[] = ['fc00::/7', 'fe80::/10'];

/** Local shell services a page must never reach over loopback: ttyd (7681) and sshd (22). */
export const LOCAL_SHELL_PORTS: readonly number[] = [7681, 22];

/**
 * Where the nameservers are named. With systemd-resolved, `/etc/resolv.conf` names only its stub on
 * loopback and the upstream servers, which some clouds put on a link-local address, are in the second.
 */
export const RESOLV_FILES: readonly string[] = [
  '/etc/resolv.conf',
  '/run/systemd/resolve/resolv.conf',
];

/** The two addresses a connection to must be refused: the cloud metadata service and one RFC 1918. */
export const REFUSED_PROBES: readonly { host: string; port: number; range: string }[] = [
  { host: '169.254.169.254', port: 80, range: '169.254.0.0/16' },
  { host: '192.168.1.1', port: 80, range: '192.168.0.0/16' },
];

/** The public name and address egress must still reach once the rules are in. */
export const PUBLIC_PROBE = {
  host: 'registry.npmjs.org',
  url: 'https://registry.npmjs.org/-/ping',
};

/** How long a refused connection may take. A dropped one waits out the full timeout instead. */
const FAST_MS = 1500;

export type Family = 4 | 6;

/** An address as iptables prints it: IPv6 in its shortest form, lower case, no zone. */
function canonical(address: string): string {
  if (isIP(address) !== 6) return address;
  return new URL(`http://[${address}]/`).hostname.replace(/^\[|\]$/g, '');
}

/** The nameserver addresses some resolv.conf texts name, each once, without an IPv6 zone. */
export function nameservers(texts: readonly string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const address = /^\s*nameserver\s+(\S+)/.exec(line)?.[1]?.split('%')[0] ?? '';
      if (!isIP(address)) continue;
      const value = canonical(address);
      if (!found.includes(value)) found.push(value);
    }
  }
  return found;
}

/**
 * The egress chain's rules for one family, in order and in the exact form `iptables-save` prints
 * them, so what is read back can be compared line for line. First what stays open: loopback,
 * replies on connections already made (the harness's inbound listeners), DNS to the nameservers,
 * and for IPv6 the neighbour discovery a link needs. Then every blocked range is refused, TCP with a
 * reset and anything else with port unreachable, so a connection fails at once instead of hanging.
 */
export function egressRules(family: Family, servers: readonly string[]): string[] {
  const rules = [
    // The computer's own shell services: ttyd serves a writable bash on 7681 with no origin check,
    // and sshd listens on 22. Page JavaScript could reach them over loopback, or the machine's own
    // address, which also leaves through lo. Local connections to them are refused; inbound
    // connections from outside arrive on another interface and are not affected.
    ...LOCAL_SHELL_PORTS.map(
      (port) => `-A ${CHAIN} -o lo -p tcp -m tcp --dport ${port} -j REJECT --reject-with tcp-reset`,
    ),
    `-A ${CHAIN} -o lo -j ACCEPT`,
    `-A ${CHAIN} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`,
  ];
  const prefix = family === 4 ? 32 : 128;
  for (const server of servers) {
    if (isIP(server) !== family) continue;
    for (const protocol of ['udp', 'tcp'])
      rules.push(
        `-A ${CHAIN} -d ${canonical(server)}/${prefix} -p ${protocol} -m ${protocol} --dport 53 -j ACCEPT`,
      );
  }
  if (family === 6) {
    // Router solicitation and advertisement, neighbour solicitation and advertisement: fe80::/10 is
    // refused below, and a link that cannot answer its neighbours loses IPv6 altogether.
    for (const type of [133, 134, 135, 136])
      rules.push(`-A ${CHAIN} -p ipv6-icmp -m icmp6 --icmpv6-type ${type} -j ACCEPT`);
  }
  const unreachable = family === 4 ? 'icmp-port-unreachable' : 'icmp6-port-unreachable';
  for (const range of family === 4 ? BLOCKED_IPV4 : BLOCKED_IPV6) {
    rules.push(`-A ${CHAIN} -d ${range} -p tcp -m tcp -j REJECT --reject-with tcp-reset`);
    rules.push(`-A ${CHAIN} -d ${range} -j REJECT --reject-with ${unreachable}`);
  }
  return rules;
}

/**
 * The `iptables-restore --noflush` input that replaces the chain's rules in one commit. Declaring a
 * chain that exists flushes it, so applying it again leaves the same rules, never a second copy, and
 * there is no moment with the chain half written. Every other chain is left as it is.
 */
export function restoreScript(rules: readonly string[]): string {
  return ['*filter', `:${CHAIN} - [0:0]`, ...rules, 'COMMIT', ''].join('\n');
}

/** The rule that sends every outgoing packet through the chain. */
export const JUMP = `-A OUTPUT -j ${CHAIN}`;

export interface SavedRule {
  rule: string;
  packets: number;
}

/** The filter table's rules from `iptables-save -c`, with each rule's packet count. */
export function parseSave(text: string): SavedRule[] {
  const rules: SavedRule[] = [];
  for (const line of text.split('\n')) {
    const match = /^\[(\d+):\d+\]\s+(-A .*?)\s*$/.exec(line);
    if (match?.[1] && match[2]) rules.push({ rule: match[2], packets: Number(match[1]) });
  }
  return rules;
}

/**
 * Why the saved rules are not exactly the chain this run wants, with the jump to it first in
 * `OUTPUT`, or null when they are.
 */
export function ruleProblem(
  saved: readonly SavedRule[],
  expected: readonly string[],
): string | null {
  const chain = saved
    .filter((item) => item.rule.startsWith(`-A ${CHAIN} `))
    .map((item) => item.rule);
  if (chain.length !== expected.length || chain.some((rule, index) => rule !== expected[index])) {
    const missing = expected.filter((rule) => !chain.includes(rule));
    const extra = chain.filter((rule) => !expected.includes(rule));
    return `${CHAIN} holds ${chain.length} rules, not the ${expected.length} written${missing.length ? `; missing: ${missing.join(' | ')}` : ''}${extra.length ? `; unexpected: ${extra.join(' | ')}` : ''}${!missing.length && !extra.length ? '; they are out of order' : ''}`;
  }
  const output = saved.filter((item) => item.rule.startsWith('-A OUTPUT '));
  if (output[0]?.rule !== JUMP)
    return output.some((item) => item.rule === JUMP)
      ? `another rule comes before "${JUMP}" in OUTPUT`
      : `OUTPUT has no "${JUMP}"`;
  return null;
}

interface Tool {
  family: Family;
  bin: string;
  restore: string;
  save: string;
}

const TOOLS: readonly Tool[] = [
  { family: 4, bin: 'iptables', restore: 'iptables-restore', save: 'iptables-save' },
  { family: 6, bin: 'ip6tables', restore: 'ip6tables-restore', save: 'ip6tables-save' },
];

interface Ran {
  ok: boolean;
  output: string;
}

function sudo(args: readonly string[], options: { input?: string; timeoutMs?: number } = {}): Ran {
  const result = spawnSync('sudo', ['-n', ...args], {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs ?? 30_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, output: output || (result.error?.message ?? '') };
}

const lastLines = (text: string) => text.split('\n').slice(-3).join(' | ');

/** Installs the iptables package when a tool is missing. */
function ensureInstalled(): void {
  const present = () =>
    TOOLS.every((tool) =>
      [tool.bin, tool.restore, tool.save].every((bin) => sudo([bin, '--version']).ok),
    );
  if (present()) return;
  const install = [
    'env',
    'DEBIAN_FRONTEND=noninteractive',
    'apt-get',
    '-o',
    'DPkg::Lock::Timeout=120',
    'install',
    '-y',
    '-q',
    '--no-install-recommends',
    'iptables',
  ];
  let ran = sudo(install, { timeoutMs: 240_000 });
  if (!ran.ok) {
    sudo(
      [
        'env',
        'DEBIAN_FRONTEND=noninteractive',
        'apt-get',
        '-o',
        'DPkg::Lock::Timeout=120',
        'update',
        '-q',
      ],
      {
        timeoutMs: 240_000,
      },
    );
    ran = sudo(install, { timeoutMs: 240_000 });
  }
  if (!ran.ok || !present())
    throw new Error(`the iptables package could not be installed: ${lastLines(ran.output)}`);
}

function saved(tool: Tool): SavedRule[] {
  const ran = sudo([tool.save, '-c', '-t', 'filter']);
  if (!ran.ok) throw new Error(`${tool.save} failed: ${lastLines(ran.output)}`);
  return parseSave(ran.output);
}

/** Writes the chain for one family, adds the jump to it when it is missing, and reads both back. */
function applyFamily(tool: Tool, rules: readonly string[]): void {
  const restored = sudo([tool.restore, '-w', '5', '--noflush'], { input: restoreScript(rules) });
  if (!restored.ok)
    throw new Error(`${tool.restore} refused the rules: ${lastLines(restored.output)}`);
  if (!sudo([tool.bin, '-w', '5', '-C', 'OUTPUT', '-j', CHAIN]).ok) {
    const inserted = sudo([tool.bin, '-w', '5', '-I', 'OUTPUT', '1', '-j', CHAIN]);
    if (!inserted.ok)
      throw new Error(
        `${tool.bin} could not add the jump to ${CHAIN}: ${lastLines(inserted.output)}`,
      );
  }
  const problem = ruleProblem(saved(tool), rules);
  if (problem) throw new Error(`${tool.bin}: ${problem}`);
}

interface Probe {
  ok: boolean;
  detail: string;
}

/** A TCP connection that must be refused at once: an error inside `FAST_MS`, not a connect or a wait. */
function refusedFast(host: string, port: number): Promise<Probe> {
  return new Promise((done) => {
    const started = Date.now();
    const socket = connect({ host, port });
    const end = (ok: boolean, what: string) => {
      socket.destroy();
      done({ ok, detail: `${host}:${port} ${what} in ${Date.now() - started} ms` });
    };
    socket.setTimeout(FAST_MS, () => end(false, 'did not fail fast (no answer)'));
    socket.on('connect', () => end(false, 'CONNECTED'));
    socket.on('error', (cause: NodeJS.ErrnoException) =>
      end(
        ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EPERM'].includes(
          cause.code ?? '',
        ),
        `refused (${cause.code ?? cause.message})`,
      ),
    );
  });
}

/**
 * Proves the rules hold: a connection to the metadata address and to an RFC 1918 address is refused
 * at once, and by these rules (their packet counts rise, so it is not the network's own block), while
 * a public name still resolves and a public HTTPS address still answers.
 */
async function verify(tool: Tool, rules: readonly string[]): Promise<string[]> {
  const zeroed = sudo([tool.bin, '-w', '5', '-Z', CHAIN]);
  if (!zeroed.ok)
    throw new Error(
      `${tool.bin} could not reset the ${CHAIN} counters: ${lastLines(zeroed.output)}`,
    );
  const notes: string[] = [];
  for (const probe of REFUSED_PROBES) {
    const result = await refusedFast(probe.host, probe.port);
    if (!result.ok)
      throw new Error(`a connection to a private address was not refused: ${result.detail}`);
    notes.push(result.detail);
  }
  const counts = saved(tool);
  const problem = ruleProblem(counts, rules);
  if (problem) throw new Error(`${tool.bin}: ${problem}`);
  for (const probe of REFUSED_PROBES) {
    const rule = `-A ${CHAIN} -d ${probe.range} -p tcp -m tcp -j REJECT --reject-with tcp-reset`;
    if (!counts.some((item) => item.rule === rule && item.packets > 0))
      throw new Error(
        `${probe.host} was refused, but not by the ${probe.range} rule, which counted no packet`,
      );
  }
  let addresses: string[];
  try {
    addresses = (await lookup(PUBLIC_PROBE.host, { all: true })).map((entry) => entry.address);
  } catch (cause) {
    throw new Error(
      `DNS no longer works: ${PUBLIC_PROBE.host} did not resolve (${cause instanceof Error ? cause.message : cause})`,
    );
  }
  if (!addresses.some((address) => privateAddress(address) === null))
    throw new Error(
      `DNS answered ${PUBLIC_PROBE.host} with no public address: ${addresses.join(', ')}`,
    );
  notes.push(`DNS ok (${PUBLIC_PROBE.host} ${addresses[0]})`);
  try {
    const response = await fetch(PUBLIC_PROBE.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    notes.push(`HTTPS ok (${PUBLIC_PROBE.url} HTTP ${response.status})`);
  } catch (cause) {
    throw new Error(
      `public HTTPS no longer works: ${PUBLIC_PROBE.url} failed (${cause instanceof Error ? cause.message : cause})`,
    );
  }
  return notes;
}

/** Set on a developer machine: the firewall is only ever written on the agent's own computer. */
const LOCAL = process.env.BR_LOCAL === '1';

/**
 * Applies the egress rules for IPv4 and IPv6 and proves they hold, or throws, so no page is ever
 * loaded without them: the capture fails closed. Safe to run again: it rewrites the same rules.
 * Returns the one line the job summary shows.
 */
export async function ensureEgressFirewall(): Promise<string> {
  if (LOCAL) return 'egress firewall: skipped (BR_LOCAL=1)';
  try {
    ensureInstalled();
    const servers = nameservers(
      RESOLV_FILES.filter((path) => existsSync(path)).map((path) => readFileSync(path, 'utf8')),
    );
    const sets = TOOLS.map((tool) => ({ tool, rules: egressRules(tool.family, servers) }));
    for (const { tool, rules } of sets) applyFamily(tool, rules);
    const ipv4 = sets.find((set) => set.tool.family === 4);
    if (!ipv4) throw new Error('no IPv4 rules were built');
    const notes = await verify(ipv4.tool, ipv4.rules);
    return `egress firewall: on (${BLOCKED_IPV4.length + BLOCKED_IPV6.length} private ranges refused for IPv4 and IPv6; DNS allowed to ${servers.join(', ') || 'no nameserver'}; ${notes.join('; ')})`;
  } catch (cause) {
    throw new Error(
      `The egress firewall is not in place, so the capture refuses to load any page. ${cause instanceof Error ? cause.message : String(cause)}. This cannot be fixed from the session: do not work around it, report it.`,
    );
  }
}
