import { readRequestHeader, resolveClientIp } from './client-ip.util';

describe('resolveClientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(
      resolveClientIp({
        headers: { 'x-forwarded-for': '203.0.113.10, 70.41.3.18' },
        ip: '127.0.0.1',
      }),
    ).toBe('203.0.113.10');
  });

  it('prefers x-sopet-client-ip over proxy hops', () => {
    expect(
      resolveClientIp({
        headers: {
          'x-sopet-client-ip': '203.0.113.10',
          'x-forwarded-for': '3.82.112.93',
        },
        ip: '3.82.112.93',
      }),
    ).toBe('203.0.113.10');
  });

  it('prefers x-vercel-forwarded-for over x-forwarded-for', () => {
    expect(
      resolveClientIp({
        headers: {
          'x-vercel-forwarded-for': '198.51.100.7',
          'x-forwarded-for': '3.82.112.93',
        },
      }),
    ).toBe('198.51.100.7');
  });

  it('falls back to req.ip then socket.remoteAddress', () => {
    expect(resolveClientIp({ headers: {}, ip: '198.51.100.7' })).toBe('198.51.100.7');
    expect(
      resolveClientIp({ headers: {}, socket: { remoteAddress: '198.51.100.8' } }),
    ).toBe('198.51.100.8');
  });

  it('returns null when no IP is present', () => {
    expect(resolveClientIp({ headers: {} })).toBeNull();
    expect(resolveClientIp(null)).toBeNull();
  });

  it('slices long addresses to 45 characters', () => {
    expect(resolveClientIp({ ip: '1'.repeat(50) })).toBe('1'.repeat(45));
  });
});

describe('readRequestHeader', () => {
  it('reads case-insensitive headers', () => {
    expect(readRequestHeader({ headers: { 'X-Sopet-Session-Id': 'abc' } }, 'x-sopet-session-id')).toBe(
      'abc',
    );
  });
});
