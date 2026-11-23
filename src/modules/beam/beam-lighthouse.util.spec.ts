import { resolveAdminBeamChargeFields, resolveBeamLighthouseBaseUrl } from './beam-lighthouse.util';

describe('resolveBeamLighthouseBaseUrl', () => {
  it('uses explicit override when set', () => {
    expect(
      resolveBeamLighthouseBaseUrl('https://api.beamcheckout.com', 'https://custom.example/'),
    ).toBe('https://custom.example');
  });

  it('derives playground host from playground API base', () => {
    expect(resolveBeamLighthouseBaseUrl('https://playground.api.beamcheckout.com')).toBe(
      'https://playground-lighthouse.beamcheckout.com',
    );
  });

  it('defaults to production Lighthouse for production API base', () => {
    expect(resolveBeamLighthouseBaseUrl('https://api.beamcheckout.com')).toBe(
      'https://lighthouse.beamcheckout.com',
    );
  });
});

describe('resolveAdminBeamChargeFields', () => {
  const base = 'https://playground-lighthouse.beamcheckout.com';
  const merchantId = 'sopet-uyz0k6';

  it('returns charge id and transaction URL for Beam charge reference', () => {
    expect(resolveAdminBeamChargeFields('ch_abc123', base, merchantId)).toEqual({
      beamChargeId: 'ch_abc123',
      beamTransactionUrl:
        'https://playground-lighthouse.beamcheckout.com/merchant/sopet-uyz0k6/accounting/transaction-history/ch_abc123',
    });
  });

  it('returns charge id without URL when merchant id is missing', () => {
    expect(resolveAdminBeamChargeFields('ch_abc123', base, '')).toEqual({
      beamChargeId: 'ch_abc123',
      beamTransactionUrl: null,
    });
    expect(resolveAdminBeamChargeFields('ch_abc123', base, null)).toEqual({
      beamChargeId: 'ch_abc123',
      beamTransactionUrl: null,
    });
  });

  it('returns nulls for bank transfer references', () => {
    expect(resolveAdminBeamChargeFields('bank_transfer:admin-1', base, merchantId)).toEqual({
      beamChargeId: null,
      beamTransactionUrl: null,
    });
  });

  it('returns nulls when reference is missing', () => {
    expect(resolveAdminBeamChargeFields(null, base, merchantId)).toEqual({
      beamChargeId: null,
      beamTransactionUrl: null,
    });
    expect(resolveAdminBeamChargeFields('  ', base, merchantId)).toEqual({
      beamChargeId: null,
      beamTransactionUrl: null,
    });
  });
});
