import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { EmailTemplateRendererService } from './email-template-renderer.service';
import { EmailTemplateCacheService } from './email-template-cache.service';
import { EmailContainer } from '../../database/entities/email-container.entity';
import { EmailContentTemplate } from '../../database/entities/email-content-template.entity';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import { DEFAULT_CONTAINER_SEED, CONTENT_TEMPLATE_SEEDS } from './email-cms.seed-data';

function buildContainer(overrides: Partial<EmailContainer> = {}): EmailContainer {
  return {
    id: 'container-1',
    name: DEFAULT_CONTAINER_SEED.name,
    htmlShell: DEFAULT_CONTAINER_SEED.htmlShell,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function seedFor(key: EmailTemplateKey) {
  const seed = CONTENT_TEMPLATE_SEEDS.find((s) => s.key === key);
  if (!seed) throw new Error(`missing seed for ${key}`);
  return seed;
}

function buildContent(
  key: EmailTemplateKey,
  overrides: Partial<EmailContentTemplate> = {},
): EmailContentTemplate {
  const seed = seedFor(key);
  return {
    id: `content-${key}`,
    key,
    name: seed.name,
    subjectTemplate: seed.subjectTemplate,
    bodyHtml: seed.bodyHtml,
    textTemplate: seed.textTemplate,
    containerId: 'container-1',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    container: undefined as unknown as EmailContainer,
    ...overrides,
  };
}

interface Mocks {
  renderer: EmailTemplateRendererService;
  contentRepo: { findOne: jest.Mock };
  containerRepo: { findOne: jest.Mock };
  cache: EmailTemplateCacheService;
}

function createRenderer(): Mocks {
  const contentRepo = { findOne: jest.fn() };
  const containerRepo = { findOne: jest.fn() };
  const configService = {
    get: (key: string) => (key === 'app.apiUrl' ? 'https://api.sopet.co.th' : undefined),
  } as unknown as ConfigService;
  const cache = new EmailTemplateCacheService(configService);

  const renderer = new EmailTemplateRendererService(
    contentRepo as unknown as Repository<EmailContentTemplate>,
    containerRepo as unknown as Repository<EmailContainer>,
    cache,
    configService,
  );

  return { renderer, contentRepo, containerRepo, cache };
}

describe('EmailTemplateRendererService', () => {
  describe('renderForSend — DB path', () => {
    it('merges content into the container slot and substitutes vars', async () => {
      const { renderer, contentRepo, containerRepo } = createRenderer();
      const container = buildContainer();
      const content = buildContent(EmailTemplateKey.PASSWORD_RESET);
      contentRepo.findOne.mockResolvedValue(content);
      containerRepo.findOne.mockResolvedValue(container);

      const result = await renderer.renderForSend(EmailTemplateKey.PASSWORD_RESET, {
        vars: { resetUrl: 'https://sopet.co.th/reset?token=abc' },
        fallbackParams: { resetUrl: 'https://sopet.co.th/reset?token=abc' },
      });

      expect(result.subject).toBe('รีเซ็ตรหัสผ่าน Sopet');
      expect(result.html).toContain('https://sopet.co.th/reset?token=abc');
      expect(result.html).toContain('https://api.sopet.co.th/images/email/sopet-logo-white.png');
      expect(result.html).not.toContain('{{{content}}}');
      expect(result.html).not.toContain('{{resetUrl}}');
      expect(result.text).toContain('https://sopet.co.th/reset?token=abc');
    });

    it('escapes scalar values in the body but injects itemsHtml raw for order_paid', async () => {
      const { renderer, contentRepo, containerRepo } = createRenderer();
      containerRepo.findOne.mockResolvedValue(buildContainer());
      contentRepo.findOne.mockResolvedValue(buildContent(EmailTemplateKey.ORDER_PAID));

      const itemsHtml = '<tr><td>สินค้า</td></tr>';
      const result = await renderer.renderForSend(EmailTemplateKey.ORDER_PAID, {
        vars: {
          orderNumber: 'ORD-<1>',
          orderDate: '1 ม.ค. 2569',
          paymentMethod: 'พร้อมเพย์',
          customerName: '<script>alert(1)</script>',
          subtotal: '฿100',
          discountAmount: '฿0',
          shippingFee: '฿50',
          total: '฿150',
          orderUrl: 'https://sopet.co.th/orders/1',
          itemsHtml,
        },
        fallbackParams: {
          orderNumber: 'ORD-<1>',
          orderDate: '1 ม.ค. 2569',
          paymentMethod: 'promptpay',
          items: [],
          subtotal: 100,
          discountAmount: 0,
          shippingFee: 50,
          total: 150,
          orderUrl: 'https://sopet.co.th/orders/1',
        },
      });

      expect(result.html).toContain(itemsHtml);
      expect(result.html).toContain('ORD-&lt;1&gt;');
      expect(result.html).not.toContain('<script>alert(1)</script>');
      expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(result.html).not.toContain('<script>');
    });

    it('caches the loaded entry and does not hit the DB twice', async () => {
      const { renderer, contentRepo, containerRepo } = createRenderer();
      containerRepo.findOne.mockResolvedValue(buildContainer());
      contentRepo.findOne.mockResolvedValue(buildContent(EmailTemplateKey.PASSWORD_RESET));

      await renderer.renderForSend(EmailTemplateKey.PASSWORD_RESET, {
        vars: { resetUrl: 'https://sopet.co.th/reset' },
        fallbackParams: { resetUrl: 'https://sopet.co.th/reset' },
      });
      await renderer.renderForSend(EmailTemplateKey.PASSWORD_RESET, {
        vars: { resetUrl: 'https://sopet.co.th/reset' },
        fallbackParams: { resetUrl: 'https://sopet.co.th/reset' },
      });

      expect(contentRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('renderForSend — fallback', () => {
    it('falls back to the TS template when content is missing', async () => {
      const { renderer, contentRepo } = createRenderer();
      contentRepo.findOne.mockResolvedValue(null);

      const result = await renderer.renderForSend(EmailTemplateKey.PASSWORD_RESET, {
        vars: { resetUrl: 'https://sopet.co.th/reset' },
        fallbackParams: { resetUrl: 'https://sopet.co.th/reset' },
      });

      expect(result.subject).toBe('รีเซ็ตรหัสผ่าน Sopet');
      expect(result.html).toContain('https://sopet.co.th/reset');
      expect(result.html).not.toContain('<script');
    });

    it('falls back when content is disabled and logs a WARN with the key/reason', async () => {
      const { renderer, contentRepo, containerRepo } = createRenderer();
      contentRepo.findOne.mockResolvedValue(
        buildContent(EmailTemplateKey.PASSWORD_RESET, { enabled: false }),
      );
      containerRepo.findOne.mockResolvedValue(buildContainer());
      const loggerSpy = jest.spyOn(
        (renderer as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );

      const result = await renderer.renderForSend(EmailTemplateKey.PASSWORD_RESET, {
        vars: { resetUrl: 'https://sopet.co.th/reset' },
        fallbackParams: { resetUrl: 'https://sopet.co.th/reset' },
      });

      expect(result.subject).toBe('รีเซ็ตรหัสผ่าน Sopet');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('EMAIL_TEMPLATE_DB_FALLBACK'));
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('reason=disabled'));
    });

    it('falls back when the referenced container cannot be resolved', async () => {
      const { renderer, contentRepo, containerRepo } = createRenderer();
      contentRepo.findOne.mockResolvedValue(buildContent(EmailTemplateKey.PASSWORD_RESET));
      containerRepo.findOne.mockResolvedValue(null);

      const result = await renderer.renderForSend(EmailTemplateKey.PASSWORD_RESET, {
        vars: { resetUrl: 'https://sopet.co.th/reset' },
        fallbackParams: { resetUrl: 'https://sopet.co.th/reset' },
      });

      expect(result.subject).toBe('รีเซ็ตรหัสผ่าน Sopet');
    });
  });

  describe('preview', () => {
    it('never sends mail and reports missing required placeholders using sample defaults', async () => {
      const { renderer, contentRepo, containerRepo } = createRenderer();
      containerRepo.findOne.mockResolvedValue(buildContainer());
      contentRepo.findOne.mockResolvedValue(undefined);

      const seed = seedFor(EmailTemplateKey.PASSWORD_RESET);
      const result = await renderer.preview({
        key: EmailTemplateKey.PASSWORD_RESET,
        subjectTemplate: seed.subjectTemplate,
        bodyHtml: seed.bodyHtml,
        textTemplate: seed.textTemplate,
        containerId: 'container-1',
        variables: {},
      });

      expect(result.missingPlaceholders).toContain('resetUrl');
      expect(result.html).not.toContain('{{resetUrl}}');
      expect(result.html).not.toContain('{{{content}}}');
    });
  });
});
