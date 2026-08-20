import * as http from 'node:http';
import * as https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateOrReservedIp } from './private-ip.util';

export type SafeUrlPin = {
  parsed: URL;
  /** Pre-resolved public address used for the TCP connect (anti DNS rebinding). */
  address: string;
  family: 4 | 6;
};

export type AssertSafeUrlOptions = {
  /** Allowed URL protocols. Default: https only. */
  protocols?: ReadonlyArray<'http:' | 'https:'>;
};

export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundUrlError';
  }
}

/**
 * Parse + DNS-resolve an outbound URL and reject private/reserved destinations.
 * Returns a pin to use with {@link fetchWithPinnedIp} so connect cannot rebind.
 */
export async function resolveSafeOutboundUrl(
  urlString: string,
  options: AssertSafeUrlOptions = {},
): Promise<SafeUrlPin> {
  const protocols = options.protocols ?? (['https:'] as const);
  let parsed: URL;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    throw new UnsafeOutboundUrlError('URL is invalid');
  }

  if (!(protocols as readonly string[]).includes(parsed.protocol)) {
    throw new UnsafeOutboundUrlError(
      `URL must use ${protocols.map((p) => p.replace(':', '')).join(' or ')}`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new UnsafeOutboundUrlError('URL must not include credentials');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '0.0.0.0'
  ) {
    throw new UnsafeOutboundUrlError('URL host is not allowed');
  }

  const resolved = isIP(hostname)
    ? [{ address: hostname, family: (isIP(hostname) || 4) as 4 | 6 }]
    : (await lookup(hostname, { all: true })).map((entry) => ({
        address: entry.address,
        family: entry.family === 6 ? (6 as const) : (4 as const),
      }));

  if (!resolved.length) {
    throw new UnsafeOutboundUrlError('URL host could not be resolved');
  }

  for (const entry of resolved) {
    if (isPrivateOrReservedIp(entry.address)) {
      throw new UnsafeOutboundUrlError('URL host is not allowed');
    }
  }

  // Prefer IPv4 for broader destination compatibility; fall back to first public address.
  const pin = resolved.find((entry) => entry.family === 4) ?? resolved[0];
  return { parsed, address: pin.address, family: pin.family };
}

export type PinnedFetchInit = {
  method?: string;
  headers?: HeadersInit;
  body?: string | Buffer | Uint8Array;
  signal?: AbortSignal;
  /** When true, do not follow redirects (caller must re-validate Location). Default true. */
  redirectManual?: boolean;
};

/**
 * Fetch using a previously resolved public IP for TCP connect while preserving
 * the original hostname for TLS SNI / Host header (BE2-010 DNS rebinding pin).
 */
export function fetchWithPinnedIp(pin: SafeUrlPin, init: PinnedFetchInit = {}): Promise<Response> {
  const { parsed, address, family } = pin;
  const lib = parsed.protocol === 'https:' ? https : http;
  const method = (init.method ?? 'GET').toUpperCase();
  const headerMap = normalizeHeaders(init.headers);
  if (!hasHeader(headerMap, 'host')) {
    headerMap.Host = parsed.host;
  }

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: headerMap,
        signal: init.signal,
        lookup: (_hostname, options, callback) => {
          const cb =
            typeof options === 'function'
              ? (options as (
                  err: NodeJS.ErrnoException | null,
                  address: string,
                  family: number,
                ) => void)
              : callback;
          cb(null, address, family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const item of value) headers.append(key, item);
            } else {
              headers.set(key, value);
            }
          }
          resolve(
            new Response(body.length === 0 && isNullBodyStatus(res.statusCode) ? null : body, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage,
              headers,
            }),
          );
        });
      },
    );

    req.on('error', reject);

    if (init.body !== undefined) {
      req.write(init.body);
    }
    req.end();
  });
}

/**
 * Resolve + pin + fetch in one step. Does not follow redirects.
 */
export async function safeFetch(
  urlString: string,
  init: PinnedFetchInit = {},
  assertOptions?: AssertSafeUrlOptions,
): Promise<{ response: Response; pin: SafeUrlPin }> {
  const pin = await resolveSafeOutboundUrl(urlString, assertOptions);
  const response = await fetchWithPinnedIp(pin, init);
  return { response, pin };
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string | string[]> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [key, value] of headers) out[key] = value;
    return out;
  }
  return { ...headers };
}

function hasHeader(headers: Record<string, string | string[]>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function isNullBodyStatus(status: number | undefined): boolean {
  return status === 204 || status === 205 || status === 304;
}
