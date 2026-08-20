import { isPrivateOrReservedIp } from './private-ip.util';

describe('isPrivateOrReservedIp', () => {
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12::1',
    '::ffff:10.0.0.1',
  ])('blocks %s', (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])('allows %s', (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(false);
  });
});
