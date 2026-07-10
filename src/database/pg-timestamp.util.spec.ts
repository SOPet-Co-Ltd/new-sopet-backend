import { types } from 'pg';
import { configurePgUtcTimestampParsing } from './pg-timestamp.util';

describe('configurePgUtcTimestampParsing', () => {
  const originalParser = types.getTypeParser(1114, 'text');

  afterEach(() => {
    types.setTypeParser(1114, originalParser);
  });

  it('parses timestamp without time zone as UTC', () => {
    configurePgUtcTimestampParsing();

    const parser = types.getTypeParser(1114, 'text') as (value: string) => Date;
    const parsed = parser('2026-07-10 08:21:14.539641');

    expect(parsed.toISOString()).toBe('2026-07-10T08:21:14.539Z');
  });
});
