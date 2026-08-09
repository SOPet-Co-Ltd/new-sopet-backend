import { scrubForLog, scrubJsonForLog } from './scrub-for-log.util';

describe('scrubForLog', () => {
  it('redacts sensitive keys', () => {
    expect(
      scrubForLog({
        message: 'fail',
        card_number: '4242424242424242',
        nested: { security_code: '123', ok: true },
      }),
    ).toEqual({
      message: 'fail',
      card_number: '[Redacted]',
      nested: { security_code: '[Redacted]', ok: true },
    });
  });

  it('serializes scrubbed JSON', () => {
    expect(scrubJsonForLog({ token: 'abc', id: 'chrg_1' })).toBe(
      JSON.stringify({ token: '[Redacted]', id: 'chrg_1' }),
    );
  });
});
