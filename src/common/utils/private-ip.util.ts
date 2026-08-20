/**
 * Returns true when the address is private, loopback, link-local, or otherwise
 * reserved — unsuitable as an outbound SSRF destination.
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
