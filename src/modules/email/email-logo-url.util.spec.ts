import {
  DEFAULT_PUBLIC_EMAIL_LOGO_URL,
  resolveEmailLogoUrl,
} from './email-logo-url.util';

describe('resolveEmailLogoUrl', () => {
  it('prefers EMAIL_LOGO_URL / explicitLogoUrl when set', () => {
    expect(
      resolveEmailLogoUrl({
        explicitLogoUrl: 'https://cdn.example.com/logo.png',
        apiUrl: 'http://localhost:3002',
      }),
    ).toBe('https://cdn.example.com/logo.png');
  });

  it('uses API_URL when the host is publicly reachable', () => {
    expect(
      resolveEmailLogoUrl({
        apiUrl: 'https://api.sopet.org',
      }),
    ).toBe('https://api.sopet.org/images/email/sopet-logo-white.png');
  });

  it('falls back to the public asset when API_URL is loopback (inbox-safe)', () => {
    expect(resolveEmailLogoUrl({ apiUrl: 'http://localhost:3002' })).toBe(
      DEFAULT_PUBLIC_EMAIL_LOGO_URL,
    );
    expect(resolveEmailLogoUrl({ apiUrl: 'http://127.0.0.1:3002' })).toBe(
      DEFAULT_PUBLIC_EMAIL_LOGO_URL,
    );
  });

  it('strips trailing slashes from api and explicit URLs', () => {
    expect(
      resolveEmailLogoUrl({
        explicitLogoUrl: 'https://cdn.example.com/logo.png/',
      }),
    ).toBe('https://cdn.example.com/logo.png');
    expect(resolveEmailLogoUrl({ apiUrl: 'https://api.sopet.org/' })).toBe(
      'https://api.sopet.org/images/email/sopet-logo-white.png',
    );
  });
});
