import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type SafeRemoteUrlProtocol = 'http:' | 'https:';

export interface AssertSafeRemoteUrlOptions {
  /** Defaults to http: and https:. Webhooks should pass `['https:']` only. */
  allowedProtocols?: readonly SafeRemoteUrlProtocol[];
  errorCode?: string;
  /** Prefixed onto each rejection message when provided. */
  errorMessagePrefix?: string;
}

function buildError(message: string, options?: AssertSafeRemoteUrlOptions): BadRequestException {
  const code = options?.errorCode ?? 'UNSAFE_REMOTE_URL';
  const fullMessage = options?.errorMessagePrefix
    ? message.replace(/^URL/, options.errorMessagePrefix)
    : message;
  return new BadRequestException({ code, message: fullMessage });
}

/**
 * Block private/reserved IPs used for SSRF (loopback, RFC1918, link-local, CGNAT, ULA).
 */
export function isPrivateOrReservedIp(address: string): boolean {
  if (address === '::1' || address === '::' || address.startsWith('fe80:')) {
    return true;
  }

  if (address.includes(':')) {
    const lower = address.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isPrivateOrReservedIp(mapped[1]);
    }
    return false;
  }

  const parts = address.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

/**
 * Validate a remote URL before fetch: scheme allow-list, no credentials, no
 * localhost/private hostnames, and DNS resolution must not land on private IPs.
 * Call again immediately before fetch to mitigate DNS rebinding.
 */
export async function assertSafeRemoteUrl(
  urlString: string,
  options?: AssertSafeRemoteUrlOptions,
): Promise<URL> {
  const allowedProtocols = options?.allowedProtocols ?? (['http:', 'https:'] as const);

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw buildError('URL is invalid', options);
  }

  if (!(allowedProtocols as readonly string[]).includes(parsed.protocol)) {
    const schemes = allowedProtocols.map((p) => p.replace(':', '')).join(' or ');
    throw buildError(`URL must use ${schemes}`, options);
  }

  if (parsed.username || parsed.password) {
    throw buildError('URL must not include credentials', options);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '0.0.0.0'
  ) {
    throw buildError('URL host is not allowed', options);
  }

  let addresses: string[];
  try {
    addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true })).map((entry) => entry.address);
  } catch {
    throw buildError('URL host could not be resolved', options);
  }

  if (!addresses.length) {
    throw buildError('URL host could not be resolved', options);
  }

  for (const address of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw buildError('URL host is not allowed', options);
    }
  }

  return parsed;
}
