import { BadRequestException } from '@nestjs/common';
import { assertSafeRemoteUrl, isPrivateOrReservedIp } from './safe-remote-url.util';

const mockLookup = jest.fn();

jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

describe('isPrivateOrReservedIp', () => {
  it('flags loopback, RFC1918, link-local, and CGNAT', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isPrivateOrReservedIp('203.0.113.10')).toBe(false);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
  });
});

describe('assertSafeRemoteUrl', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
  });

  it('accepts https public hosts', async () => {
    const parsed = await assertSafeRemoteUrl('https://hooks.example.com/path', {
      allowedProtocols: ['https:'],
      errorCode: 'INVALID_WEBHOOK_URL',
    });
    expect(parsed.hostname).toBe('hooks.example.com');
  });

  it('rejects http when https-only', async () => {
    await expect(
      assertSafeRemoteUrl('http://hooks.example.com/path', {
        allowedProtocols: ['https:'],
        errorCode: 'INVALID_WEBHOOK_URL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects private IPs and localhost', async () => {
    await expect(assertSafeRemoteUrl('https://127.0.0.1/hook')).rejects.toMatchObject({
      response: { code: 'UNSAFE_REMOTE_URL' },
    });
    await expect(assertSafeRemoteUrl('https://localhost/hook')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects DNS that resolves to a private IP', async () => {
    mockLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    await expect(assertSafeRemoteUrl('https://evil.example.com/hook')).rejects.toMatchObject({
      response: { code: 'UNSAFE_REMOTE_URL' },
    });
  });
});
