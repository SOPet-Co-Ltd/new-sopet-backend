import { lookup } from 'node:dns/promises';
import {
  fetchWithPinnedIp,
  resolveSafeOutboundUrl,
  UnsafeOutboundUrlError,
} from './safe-fetch.util';
import { isPrivateOrReservedIp } from './private-ip.util';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockHttpsRequest = jest.fn();
jest.mock('node:https', () => ({
  request: (...args: unknown[]) => mockHttpsRequest(...args),
}));

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;

describe('safe-fetch util (BE2-010)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveSafeOutboundUrl', () => {
    it('rejects private DNS results', async () => {
      lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);

      await expect(resolveSafeOutboundUrl('https://evil.example/hook')).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError,
      );
    });

    it('pins the resolved public address', async () => {
      lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);

      const pin = await resolveSafeOutboundUrl('https://example.com/hook');
      expect(pin.address).toBe('93.184.216.34');
      expect(pin.family).toBe(4);
      expect(pin.parsed.hostname).toBe('example.com');
    });

    it('rejects literal private IP hosts without DNS', async () => {
      await expect(resolveSafeOutboundUrl('https://127.0.0.1/x')).rejects.toBeInstanceOf(
        UnsafeOutboundUrlError,
      );
      expect(lookupMock).not.toHaveBeenCalled();
    });

    it('prefers IPv4 pin when both families resolve', async () => {
      lookupMock.mockResolvedValue([
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ] as never);

      const pin = await resolveSafeOutboundUrl('https://example.com/');
      expect(pin.address).toBe('93.184.216.34');
      expect(pin.family).toBe(4);
    });
  });

  describe('fetchWithPinnedIp DNS rebinding', () => {
    it('connects via lookup override to the pinned IP (not a later DNS result)', async () => {
      const pin = {
        parsed: new URL('https://example.com/hook'),
        address: '93.184.216.34',
        family: 4 as const,
      };

      // Simulate rebinding: hostname would now resolve private, but pin must win.
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);

      mockHttpsRequest.mockImplementation(
        (
          options: {
            hostname?: string;
            servername?: string;
            lookup?: (
              hostname: string,
              options: unknown,
              callback: (err: Error | null, address: string, family: number) => void,
            ) => void;
          },
          callback?: (res: {
            statusCode: number;
            statusMessage: string;
            headers: Record<string, string>;
            on: (event: string, handler: (...args: unknown[]) => void) => unknown;
          }) => void,
        ) => {
          expect(options.hostname).toBe('example.com');
          expect(options.servername).toBe('example.com');
          expect(typeof options.lookup).toBe('function');

          let pinnedAddress: string | undefined;
          options.lookup?.('example.com', { family: 0 }, (err, address, family) => {
            expect(err).toBeNull();
            pinnedAddress = address;
            expect(family).toBe(4);
          });
          expect(pinnedAddress).toBe('93.184.216.34');

          const res = {
            statusCode: 200,
            statusMessage: 'OK',
            headers: {},
            on: (event: string, handler: (...args: unknown[]) => void) => {
              if (event === 'data') return res;
              if (event === 'end') {
                handler();
              }
              return res;
            },
          };

          callback?.(res);

          return {
            on: jest.fn(),
            write: jest.fn(),
            end: jest.fn(),
          };
        },
      );

      const response = await fetchWithPinnedIp(pin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(200);
      expect(mockHttpsRequest).toHaveBeenCalled();
    });
  });
});
