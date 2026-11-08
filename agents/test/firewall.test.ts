import { describe, expect, it } from 'vitest';
import {
  BLOCKED_IPV4,
  BLOCKED_IPV6,
  CHAIN,
  egressRules,
  JUMP,
  LOCAL_SHELL_PORTS,
  nameservers,
  parseSave,
  REFUSED_PROBES,
  restoreScript,
  ruleProblem,
} from '../src/capture/firewall.ts';

const STUB =
  '# This is /run/systemd/resolve/stub-resolv.conf\nnameserver 127.0.0.53\noptions edns0\n';
const UPSTREAM =
  'nameserver 169.254.169.253\nnameserver 1.1.1.1\nnameserver 1.1.1.1\nnameserver fe80::1%ens4\nsearch .\n';

/** The rules as `iptables-save -c` prints them, each with a packet count. */
const saveOf = (rules: readonly string[], packets = 0, jumpFirst = true) =>
  [
    '*filter',
    ':OUTPUT ACCEPT [0:0]',
    `:${CHAIN} - [0:0]`,
    ...(jumpFirst
      ? [`[9:540] ${JUMP}`]
      : ['[1:60] -A OUTPUT -d 8.8.8.8/32 -j ACCEPT', `[9:540] ${JUMP}`]),
    ...rules.map((rule) => `[${packets}:0] ${rule}`),
    'COMMIT',
  ].join('\n');

describe('nameservers', () => {
  it('reads every nameserver once, from the stub and the upstream file, without a zone', () => {
    expect(nameservers([STUB, UPSTREAM])).toEqual([
      '127.0.0.53',
      '169.254.169.253',
      '1.1.1.1',
      'fe80::1',
    ]);
  });

  it('ignores comments, options and anything that is not an address', () => {
    expect(
      nameservers(['# nameserver 9.9.9.9\nnameserver resolver.local\noptions ndots:1\n']),
    ).toEqual([]);
  });

  it('writes an IPv6 nameserver in the short form iptables prints', () => {
    expect(nameservers(['nameserver 2001:4860:4860:0000:0000:0000:0000:8888\n'])).toEqual([
      '2001:4860:4860::8888',
    ]);
  });
});

describe('egressRules', () => {
  const servers = nameservers([STUB, UPSTREAM]);
  const v4 = egressRules(4, servers);
  const v6 = egressRules(6, servers);

  it('refuses local connections to the shell services, then keeps loopback and replies open', () => {
    expect(v4.slice(0, 4)).toEqual([
      `-A ${CHAIN} -o lo -p tcp -m tcp --dport 7681 -j REJECT --reject-with tcp-reset`,
      `-A ${CHAIN} -o lo -p tcp -m tcp --dport 22 -j REJECT --reject-with tcp-reset`,
      `-A ${CHAIN} -o lo -j ACCEPT`,
      `-A ${CHAIN} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`,
    ]);
    expect(v6.slice(0, 4)).toEqual(v4.slice(0, 4));
    expect(LOCAL_SHELL_PORTS).toEqual([7681, 22]);
  });

  it('refuses every private IPv4 range, TCP with a reset and the rest with port unreachable', () => {
    for (const range of BLOCKED_IPV4) {
      expect(v4).toContain(
        `-A ${CHAIN} -d ${range} -p tcp -m tcp -j REJECT --reject-with tcp-reset`,
      );
      expect(v4).toContain(`-A ${CHAIN} -d ${range} -j REJECT --reject-with icmp-port-unreachable`);
    }
    expect(BLOCKED_IPV4).toEqual([
      '169.254.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '100.64.0.0/10',
      '0.0.0.0/8',
      '224.0.0.0/4',
    ]);
    expect(v4.filter((rule) => rule.includes('REJECT'))).toHaveLength(
      BLOCKED_IPV4.length * 2 + LOCAL_SHELL_PORTS.length,
    );
  });

  it('refuses unique-local and link-local IPv6, and never names an IPv4 range there', () => {
    expect(BLOCKED_IPV6).toEqual(['fc00::/7', 'fe80::/10']);
    for (const range of BLOCKED_IPV6) {
      expect(v6).toContain(
        `-A ${CHAIN} -d ${range} -p tcp -m tcp -j REJECT --reject-with tcp-reset`,
      );
      expect(v6).toContain(
        `-A ${CHAIN} -d ${range} -j REJECT --reject-with icmp6-port-unreachable`,
      );
    }
    expect(v6.filter((rule) => rule.includes('REJECT'))).toHaveLength(
      BLOCKED_IPV6.length * 2 + LOCAL_SHELL_PORTS.length,
    );
    expect(v6.some((rule) => /\d+\.\d+\.\d+\.\d+/.test(rule))).toBe(false);
  });

  // Some clouds answer DNS on a link-local address: its ACCEPT must come before the REJECT of
  // 169.254.0.0/16, or no name resolves once the rules are in.
  it('lets DNS through to a link-local nameserver before 169.254.0.0/16 is refused', () => {
    const udp = v4.indexOf(`-A ${CHAIN} -d 169.254.169.253/32 -p udp -m udp --dport 53 -j ACCEPT`);
    const tcp = v4.indexOf(`-A ${CHAIN} -d 169.254.169.253/32 -p tcp -m tcp --dport 53 -j ACCEPT`);
    const reject = v4.findIndex((rule) => rule.includes('-d 169.254.0.0/16'));
    expect(udp).toBeGreaterThan(-1);
    expect(tcp).toBeGreaterThan(-1);
    expect(reject).toBeGreaterThan(Math.max(udp, tcp));
  });

  it('opens port 53 only, and only to the nameservers of its own family', () => {
    const accepts = v4.filter((rule) => rule.endsWith('-j ACCEPT') && rule.includes(' -d '));
    expect(accepts).toEqual([
      `-A ${CHAIN} -d 127.0.0.53/32 -p udp -m udp --dport 53 -j ACCEPT`,
      `-A ${CHAIN} -d 127.0.0.53/32 -p tcp -m tcp --dport 53 -j ACCEPT`,
      `-A ${CHAIN} -d 169.254.169.253/32 -p udp -m udp --dport 53 -j ACCEPT`,
      `-A ${CHAIN} -d 169.254.169.253/32 -p tcp -m tcp --dport 53 -j ACCEPT`,
      `-A ${CHAIN} -d 1.1.1.1/32 -p udp -m udp --dport 53 -j ACCEPT`,
      `-A ${CHAIN} -d 1.1.1.1/32 -p tcp -m tcp --dport 53 -j ACCEPT`,
    ]);
    expect(v6.filter((rule) => rule.includes('--dport 53'))).toEqual([
      `-A ${CHAIN} -d fe80::1/128 -p udp -m udp --dport 53 -j ACCEPT`,
      `-A ${CHAIN} -d fe80::1/128 -p tcp -m tcp --dport 53 -j ACCEPT`,
    ]);
  });

  it('keeps IPv6 neighbour discovery working although fe80::/10 is refused', () => {
    const reject = v6.findIndex((rule) => rule.includes('-d fe80::/10'));
    for (const type of [133, 134, 135, 136]) {
      const accept = v6.indexOf(
        `-A ${CHAIN} -p ipv6-icmp -m icmp6 --icmpv6-type ${type} -j ACCEPT`,
      );
      expect(accept).toBeGreaterThan(-1);
      expect(accept).toBeLessThan(reject);
    }
    expect(v4.some((rule) => rule.includes('icmp6'))).toBe(false);
  });

  it('builds the same rules each time, so applying them again changes nothing', () => {
    expect(egressRules(4, servers)).toEqual(v4);
    expect(egressRules(4, [])).toEqual(v4.filter((rule) => !rule.includes('--dport 53')));
  });

  it('refuses the addresses the verification probes, by a TCP reset rule it can count', () => {
    for (const probe of REFUSED_PROBES)
      expect(v4).toContain(
        `-A ${CHAIN} -d ${probe.range} -p tcp -m tcp -j REJECT --reject-with tcp-reset`,
      );
  });
});

describe('restoreScript', () => {
  it('declares the chain, which flushes it, then writes its rules in one commit', () => {
    const rules = egressRules(4, ['1.1.1.1']);
    const script = restoreScript(rules);
    expect(script.split('\n')).toEqual(['*filter', `:${CHAIN} - [0:0]`, ...rules, 'COMMIT', '']);
    expect(script).not.toMatch(/-A OUTPUT|-F |-X /);
  });
});

describe('parseSave and ruleProblem', () => {
  const rules = egressRules(4, ['1.1.1.1']);

  it('reads each rule and its packet count from iptables-save -c', () => {
    const saved = parseSave(saveOf(rules, 3));
    expect(saved[0]).toEqual({ rule: JUMP, packets: 9 });
    expect(saved.slice(1).map((item) => item.rule)).toEqual(rules);
    expect(saved.slice(1).every((item) => item.packets === 3)).toBe(true);
  });

  it('accepts exactly the rules written, with the jump first in OUTPUT', () => {
    expect(ruleProblem(parseSave(saveOf(rules)), rules)).toBeNull();
  });

  it('refuses a chain that lost a rule, gained a copy, or holds them out of order', () => {
    expect(ruleProblem(parseSave(saveOf(rules.slice(0, -1))), rules)).toMatch(
      /missing: .*224\.0\.0\.0\/4/,
    );
    expect(ruleProblem(parseSave(saveOf([...rules, ...rules])), rules)).toMatch(/holds \d+ rules/);
    expect(ruleProblem(parseSave(saveOf([...rules].reverse())), rules)).toMatch(/out of order/);
  });

  it('refuses rules OUTPUT never jumps to first', () => {
    expect(ruleProblem(parseSave(saveOf(rules, 0, false)), rules)).toMatch(/comes before/);
    const noJump = saveOf(rules)
      .split('\n')
      .filter((line) => !line.includes(JUMP))
      .join('\n');
    expect(ruleProblem(parseSave(noJump), rules)).toMatch(/OUTPUT has no/);
  });
});
