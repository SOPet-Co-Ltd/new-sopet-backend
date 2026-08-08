import { ConfigService } from '@nestjs/config';
import { EmailTemplateCacheService } from './email-template-cache.service';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';

function createService(ttlMs = 60_000): EmailTemplateCacheService {
  const configService = { get: () => ttlMs } as unknown as ConfigService;
  return new EmailTemplateCacheService(configService);
}

describe('EmailTemplateCacheService', () => {
  it('returns undefined on a miss', () => {
    const cache = createService();
    expect(cache.get(EmailTemplateKey.PASSWORD_RESET)).toBeUndefined();
  });

  it('returns the cached entry on a hit', () => {
    const cache = createService();
    const entry = { content: null, container: null };
    cache.set(EmailTemplateKey.PASSWORD_RESET, entry);
    expect(cache.get(EmailTemplateKey.PASSWORD_RESET)).toBe(entry);
  });

  it('expires entries after the configured TTL', () => {
    jest.useFakeTimers();
    try {
      const cache = createService(1000);
      cache.set(EmailTemplateKey.PASSWORD_RESET, { content: null, container: null });
      expect(cache.get(EmailTemplateKey.PASSWORD_RESET)).toBeDefined();

      jest.advanceTimersByTime(1001);

      expect(cache.get(EmailTemplateKey.PASSWORD_RESET)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidateKey removes only the given key', () => {
    const cache = createService();
    cache.set(EmailTemplateKey.PASSWORD_RESET, { content: null, container: null });
    cache.set(EmailTemplateKey.EMAIL_VERIFICATION, { content: null, container: null });

    cache.invalidateKey(EmailTemplateKey.PASSWORD_RESET);

    expect(cache.get(EmailTemplateKey.PASSWORD_RESET)).toBeUndefined();
    expect(cache.get(EmailTemplateKey.EMAIL_VERIFICATION)).toBeDefined();
  });

  it('invalidateAll clears every key', () => {
    const cache = createService();
    cache.set(EmailTemplateKey.PASSWORD_RESET, { content: null, container: null });
    cache.set(EmailTemplateKey.EMAIL_VERIFICATION, { content: null, container: null });

    cache.invalidateAll();

    expect(cache.get(EmailTemplateKey.PASSWORD_RESET)).toBeUndefined();
    expect(cache.get(EmailTemplateKey.EMAIL_VERIFICATION)).toBeUndefined();
  });
});
