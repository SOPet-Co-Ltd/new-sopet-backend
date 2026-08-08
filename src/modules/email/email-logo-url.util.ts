/** Default public logo used when `API_URL` is loopback (email clients cannot fetch localhost). */
export const DEFAULT_PUBLIC_EMAIL_LOGO_URL =
  'https://api.sopet.org/images/email/sopet-logo-white.png';

const EMAIL_LOGO_PATH = '/images/email/sopet-logo-white.png';

const LOOPBACK_HOST =
  /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i;

export interface ResolveEmailLogoUrlInput {
  /** Explicit absolute logo URL (`EMAIL_LOGO_URL`). Wins when set. */
  explicitLogoUrl?: string | null;
  /** Public API base (`API_URL` / `app.apiUrl`). */
  apiUrl?: string | null;
  /** Override for the loopback fallback (tests). */
  publicFallbackUrl?: string;
}

/**
 * Absolute HTTPS-friendly logo URL for transactional email `<img src>`.
 *
 * Priority:
 * 1. `EMAIL_LOGO_URL` when set
 * 2. `${API_URL}/images/email/sopet-logo-white.png` when API host is not loopback
 * 3. Public production asset (loopback `API_URL` — local preview still works via network;
 *    real inboxes cannot load localhost)
 */
export function resolveEmailLogoUrl(input: ResolveEmailLogoUrlInput): string {
  const explicit = input.explicitLogoUrl?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const apiUrl = (input.apiUrl?.trim() || 'http://localhost:3002').replace(/\/$/, '');
  if (LOOPBACK_HOST.test(apiUrl)) {
    return (input.publicFallbackUrl || DEFAULT_PUBLIC_EMAIL_LOGO_URL).replace(/\/$/, '');
  }

  return `${apiUrl}${EMAIL_LOGO_PATH}`;
}
