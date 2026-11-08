import { lookup as dnsLookup, resolveMx } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isSpecialAddress, type RawResponse, type Transport } from './fetcher.ts';

/**
 * The Node transport for `safeFetch`. It resolves with the system resolver and, through the
 * socket's own `lookup`, refuses to connect to any address `isSpecialAddress` rejects, so a host
 * that resolves to a public address for the check and a private one for the connection is still
 * refused. No cookies, no proxy, no keep-alive.
 */

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true })
    .then((addresses) => {
      const bad = addresses.find((item) => isSpecialAddress(item.address));
      if (bad || !addresses.length) {
        const error = Object.assign(new Error(`${hostname} resolves to a non-public address`), {
          code: 'EADDRNOTALLOWED',
        });
        callback(error, '', 0);
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0] as { address: string; family: number };
      callback(null, first.address, first.family);
    })
    .catch((error: NodeJS.ErrnoException) => callback(error, '', 0));
};

export const nodeTransport: Transport = {
  async resolve(host) {
    const addresses = await dnsLookup(host, { all: true });
    return addresses.map((item) => item.address);
  },
  get(url, options) {
    return new Promise<RawResponse>((resolve, reject) => {
      const target = new URL(url);
      const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = send(
        target,
        {
          method: 'GET',
          headers: { ...options.headers, 'accept-encoding': 'identity' },
          lookup: guardedLookup,
          agent: false,
          timeout: options.timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          response.on('data', (chunk: Buffer) => {
            if (truncated) return;
            size += chunk.length;
            if (size > options.maxBytes) {
              truncated = true;
              chunks.push(chunk.subarray(0, chunk.length - (size - options.maxBytes)));
              response.destroy();
              finish();
              return;
            }
            chunks.push(chunk);
          });
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              if (typeof value === 'string') headers[key.toLowerCase()] = value;
              else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ');
            }
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks).toString('utf8'),
              truncated,
            });
          };
          response.on('end', finish);
          response.on('close', finish);
          response.on('error', (error) => (done ? undefined : reject(error)));
        },
      );
      // A hard deadline for the whole response, not only for idle sockets.
      const timer = setTimeout(() => request.destroy(new Error('timeout')), options.timeoutMs);
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      request.end();
    });
  },
};

/** Whether a domain has MX records. A cold email to a domain without them is skipped. */
export async function hasMx(domain: string): Promise<boolean> {
  try {
    return (await resolveMx(domain)).length > 0;
  } catch {
    return false;
  }
}
