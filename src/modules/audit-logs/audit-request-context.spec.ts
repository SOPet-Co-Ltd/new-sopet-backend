import { getAuditRequestContext } from './audit-request-context';

describe('getAuditRequestContext', () => {
  it('uses x-request-id header when present', () => {
    const req = {
      headers: { 'x-request-id': 'corr-from-header' },
      ip: '203.0.113.9',
    };

    const result = getAuditRequestContext(req);

    expect(result.requestId).toBe('corr-from-header');
  });

  it('uses the first array element when x-request-id is an array', () => {
    const req = {
      headers: { 'x-request-id': ['first-id', 'second-id'] },
    };

    expect(getAuditRequestContext(req).requestId).toBe('first-id');
  });

  it('prefers existing req.requestId over the header', () => {
    const req = {
      requestId: 'already-set',
      headers: { 'x-request-id': 'header-id' },
    };

    expect(getAuditRequestContext(req).requestId).toBe('already-set');
  });

  it('generates a uuid ≤64 chars and assigns it to req.requestId when header is missing', () => {
    const req: { headers: Record<string, string>; requestId?: string } = { headers: {} };

    const result = getAuditRequestContext(req);

    expect(result.requestId).toEqual(expect.any(String));
    expect(result.requestId!.length).toBeGreaterThan(0);
    expect(result.requestId!.length).toBeLessThanOrEqual(64);
    expect(result.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(req.requestId).toBe(result.requestId);
  });

  it('slices requestId to 64 characters', () => {
    const longId = 'r'.repeat(80);
    const req = { headers: { 'x-request-id': longId } };

    expect(getAuditRequestContext(req).requestId).toBe('r'.repeat(64));
  });

  it('takes the first hop of x-forwarded-for', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.10, 70.41.3.18, 150.172.238.178' },
      ip: '127.0.0.1',
    };

    expect(getAuditRequestContext(req).ipAddress).toBe('203.0.113.10');
  });

  it('falls back to req.ip when x-forwarded-for is absent', () => {
    const req = { headers: {}, ip: '198.51.100.7' };

    expect(getAuditRequestContext(req).ipAddress).toBe('198.51.100.7');
  });

  it('slices ipAddress to 45 characters', () => {
    const longIp = '1'.repeat(50);
    const req = { ip: longIp };

    expect(getAuditRequestContext(req).ipAddress).toBe('1'.repeat(45));
  });

  it('returns null ipAddress when neither forwarded-for nor req.ip is present', () => {
    expect(getAuditRequestContext({ headers: {} }).ipAddress).toBeNull();
  });

  it('returns nulls and does not throw for null/undefined req', () => {
    expect(getAuditRequestContext(null)).toEqual({ requestId: null, ipAddress: null });
    expect(getAuditRequestContext(undefined)).toEqual({ requestId: null, ipAddress: null });
  });

  it('spreads the same helper requestId into log args that dual-write will persist', () => {
    const req = {
      headers: { 'x-request-id': 'same-value-id' },
      ip: '203.0.113.11',
    };
    const ctx = getAuditRequestContext(req);
    const logInput = {
      action: 'vendor.updated',
      ...ctx,
    };

    expect(logInput.requestId).toBe('same-value-id');
    expect(logInput.ipAddress).toBe('203.0.113.11');
    expect(logInput.requestId).toBe(ctx.requestId);
  });
});
