const PRODUCTION_LIGHTHOUSE_BASE = 'https://lighthouse.beamcheckout.com';
const PLAYGROUND_LIGHTHOUSE_BASE = 'https://playground-lighthouse.beamcheckout.com';

/**
 * Resolve Beam Lighthouse browser base URL for admin deep-links.
 * Prefer explicit override; otherwise derive playground vs production from the API host.
 */
export function resolveBeamLighthouseBaseUrl(apiBaseUrl: string, override?: string | null): string {
  const trimmedOverride = (override ?? '').trim().replace(/\/$/, '');
  if (trimmedOverride) {
    return trimmedOverride;
  }

  const api = (apiBaseUrl || '').replace(/\/$/, '');
  if (api.includes('playground')) {
    return PLAYGROUND_LIGHTHOUSE_BASE;
  }
  return PRODUCTION_LIGHTHOUSE_BASE;
}

export function resolveAdminBeamChargeFields(
  paymentReference: string | null | undefined,
  lighthouseBaseUrl: string,
  merchantId?: string | null,
): { beamChargeId: string | null; beamTransactionUrl: string | null } {
  const ref = paymentReference?.trim() ?? '';
  if (!ref || ref.startsWith('bank_transfer:')) {
    return { beamChargeId: null, beamTransactionUrl: null };
  }

  const slug = merchantId?.trim() ?? '';
  if (!slug) {
    return { beamChargeId: ref, beamTransactionUrl: null };
  }

  const base = lighthouseBaseUrl.replace(/\/$/, '');
  return {
    beamChargeId: ref,
    beamTransactionUrl: `${base}/merchant/${encodeURIComponent(slug)}/accounting/transaction-history/${encodeURIComponent(ref)}`,
  };
}
