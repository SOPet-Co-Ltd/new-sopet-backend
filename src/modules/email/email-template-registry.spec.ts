import {
  EmailTemplateKey,
  EMAIL_TEMPLATE_KEYS,
} from '../../database/entities/enums/email-template.enums';
import {
  getContainerSystemPlaceholders,
  getPlaceholdersForKey,
  getTrustedPlaceholderNames,
} from './email-template-registry';

describe('email-template-registry', () => {
  it('defines a non-empty placeholder list for every EmailTemplateKey', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      expect(getPlaceholdersForKey(key).length).toBeGreaterThan(0);
    }
  });

  it('marks itemsHtml as the only trusted placeholder for order_paid', () => {
    const trusted = getTrustedPlaceholderNames(EmailTemplateKey.ORDER_PAID);
    expect(trusted).toEqual(new Set(['itemsHtml']));
  });

  it('has no trusted placeholders outside order_paid', () => {
    for (const key of EMAIL_TEMPLATE_KEYS) {
      if (key === EmailTemplateKey.ORDER_PAID) continue;
      expect(getTrustedPlaceholderNames(key).size).toBe(0);
    }
  });

  it('requires inviteUrl for all invite-style keys', () => {
    for (const key of [
      EmailTemplateKey.VENDOR_INVITE,
      EmailTemplateKey.ADMIN_INVITE,
      EmailTemplateKey.STORE_MEMBER_INVITE,
    ]) {
      const placeholders = getPlaceholdersForKey(key);
      const inviteUrl = placeholders.find((p) => p.name === 'inviteUrl');
      expect(inviteUrl).toBeDefined();
      expect(inviteUrl?.required).toBe(true);
    }
  });

  it('exposes logoUrl as a required system placeholder for containers', () => {
    const systemPlaceholders = getContainerSystemPlaceholders();
    const logoUrl = systemPlaceholders.find((p) => p.name === 'logoUrl');
    expect(logoUrl).toBeDefined();
    expect(logoUrl?.required).toBe(true);
    expect(logoUrl?.trustedHtml).toBe(false);
  });
});
