import { BadRequestException } from '@nestjs/common';
import { EmailCmsService } from './email-cms.service';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import { DEFAULT_CONTAINER_SEED, CONTENT_TEMPLATE_SEEDS } from './email-cms.seed-data';

function seedFor(key: EmailTemplateKey) {
  const seed = CONTENT_TEMPLATE_SEEDS.find((s) => s.key === key);
  if (!seed) throw new Error(`missing seed for ${key}`);
  return seed;
}

function createService() {
  const containerRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn((entity) =>
      Promise.resolve({
        id: 'container-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...entity,
      }),
    ),
  };
  const contentRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((entity) => Promise.resolve(entity)),
  };
  const cache = { invalidateAll: jest.fn(), invalidateKey: jest.fn() };
  const renderer = { preview: jest.fn() };
  const emailService = { send: jest.fn() };

  const service = new EmailCmsService(
    containerRepo as never,
    contentRepo as never,
    cache as never,
    renderer as never,
    emailService as never,
  );

  return { service, containerRepo, contentRepo, cache, renderer, emailService };
}

describe('EmailCmsService — containers', () => {
  it('createContainer rejects a shell missing the {{{content}}} slot', async () => {
    const { service } = createService();
    await expect(
      service.createContainer({ name: 'Broken', htmlShell: '<html>no slot</html>' }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_CONTAINER_SLOT_INVALID' } });
  });

  it('createContainer accepts the seeded default shell and invalidates the cache', async () => {
    const { service, cache } = createService();
    const result = await service.createContainer({
      name: DEFAULT_CONTAINER_SEED.name,
      htmlShell: DEFAULT_CONTAINER_SEED.htmlShell,
      isDefault: true,
    });

    expect(result.container.htmlShell).toBe(DEFAULT_CONTAINER_SEED.htmlShell);
    expect(cache.invalidateAll).toHaveBeenCalled();
  });

  it('updateContainer 404s (BadRequestException) for an unknown id', async () => {
    const { service, containerRepo } = createService();
    containerRepo.findOne.mockResolvedValue(null);

    await expect(service.updateContainer('missing-id', { name: 'x' })).rejects.toMatchObject({
      response: { code: 'EMAIL_TEMPLATE_NOT_FOUND' },
    });
  });

  it('updateContainer rejects clearing the sole default container', async () => {
    const { service, containerRepo } = createService();
    containerRepo.findOne.mockResolvedValue({
      id: 'c1',
      name: 'Default',
      htmlShell: DEFAULT_CONTAINER_SEED.htmlShell,
      isDefault: true,
    });

    await expect(service.updateContainer('c1', { isDefault: false })).rejects.toMatchObject({
      response: { code: 'EMAIL_DEFAULT_CONTAINER_REQUIRED' },
    });
  });

  it('updateContainer rejects blocked HTML constructs', async () => {
    const { service, containerRepo } = createService();
    containerRepo.findOne.mockResolvedValue({
      id: 'c1',
      name: 'Default',
      htmlShell: DEFAULT_CONTAINER_SEED.htmlShell,
      isDefault: true,
    });

    await expect(
      service.updateContainer('c1', { htmlShell: '{{{content}}} <script>x</script>' }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_HTML_BLOCKED' } });
  });
});

describe('EmailCmsService — content templates', () => {
  it('updateContentTemplate rejects unknown {{vars}}', async () => {
    const { service, contentRepo } = createService();
    const seed = seedFor(EmailTemplateKey.PASSWORD_RESET);
    contentRepo.findOne.mockResolvedValue({
      id: 'content-1',
      key: EmailTemplateKey.PASSWORD_RESET,
      name: seed.name,
      subjectTemplate: seed.subjectTemplate,
      bodyHtml: seed.bodyHtml,
      textTemplate: seed.textTemplate,
      containerId: 'container-1',
      enabled: true,
    });

    await expect(
      service.updateContentTemplate('content-1', { bodyHtml: '<p>{{notAllowedVar}}</p>' }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_UNKNOWN_PLACEHOLDERS' } });
  });

  it('updateContentTemplate accepts a valid edit and invalidates only that key', async () => {
    const { service, contentRepo, cache } = createService();
    const seed = seedFor(EmailTemplateKey.PASSWORD_RESET);
    contentRepo.findOne.mockResolvedValue({
      id: 'content-1',
      key: EmailTemplateKey.PASSWORD_RESET,
      name: seed.name,
      subjectTemplate: seed.subjectTemplate,
      bodyHtml: seed.bodyHtml,
      textTemplate: seed.textTemplate,
      containerId: 'container-1',
      enabled: true,
    });

    const result = await service.updateContentTemplate('content-1', {
      bodyHtml: '<p>New body {{resetUrl}}</p>',
    });

    expect(result.content.bodyHtml).toBe('<p>New body {{resetUrl}}</p>');
    expect(cache.invalidateKey).toHaveBeenCalledWith(EmailTemplateKey.PASSWORD_RESET);
  });

  it('updateContentTemplate rejects an unknown containerId', async () => {
    const { service, contentRepo, containerRepo } = createService();
    const seed = seedFor(EmailTemplateKey.PASSWORD_RESET);
    contentRepo.findOne.mockResolvedValue({
      id: 'content-1',
      key: EmailTemplateKey.PASSWORD_RESET,
      name: seed.name,
      subjectTemplate: seed.subjectTemplate,
      bodyHtml: seed.bodyHtml,
      textTemplate: seed.textTemplate,
      containerId: 'container-1',
      enabled: true,
    });
    containerRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateContentTemplate('content-1', { containerId: 'does-not-exist' }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_TEMPLATE_NOT_FOUND' } });
  });

  it('updateContentTemplate 404s for an unknown id', async () => {
    const { service, contentRepo } = createService();
    contentRepo.findOne.mockResolvedValue(null);

    await expect(
      service.updateContentTemplate('missing', { bodyHtml: '<p>x</p>' }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_TEMPLATE_NOT_FOUND' } });
  });
});

describe('EmailCmsService — preview / test send', () => {
  it('previewContentTemplate never calls EmailService.send', async () => {
    const { service, renderer, emailService } = createService();
    renderer.preview.mockResolvedValue({
      subject: 's',
      html: '<p>h</p>',
      text: 't',
      missingPlaceholders: [],
      warnings: [],
    });

    await service.previewContentTemplate({ key: EmailTemplateKey.PASSWORD_RESET });

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('previewContentTemplate rejects unknown placeholders in the provided buffer', async () => {
    const { service } = createService();

    await expect(
      service.previewContentTemplate({
        key: EmailTemplateKey.PASSWORD_RESET,
        subjectTemplate: 'Subject',
        bodyHtml: '<p>{{unknownVar}}</p>',
      }),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_UNKNOWN_PLACEHOLDERS' } });
  });

  it('previewContentTemplate rejects invalid variablesJson', async () => {
    const { service } = createService();

    await expect(
      service.previewContentTemplate({
        key: EmailTemplateKey.PASSWORD_RESET,
        variablesJson: 'not-json',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sendTestEmailContentTemplate sends via EmailService and returns true on success', async () => {
    const { service, renderer, emailService } = createService();
    renderer.preview.mockResolvedValue({
      subject: 'Subject',
      html: '<p>h</p>',
      text: 't',
      missingPlaceholders: [],
      warnings: [],
    });
    emailService.send.mockResolvedValue({ id: 'msg-1' });

    const result = await service.sendTestEmailContentTemplate(
      { key: EmailTemplateKey.PASSWORD_RESET },
      'admin@sopet.org',
    );

    expect(result).toBe(true);
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@sopet.org', forceSend: true }),
    );
  });

  it('sendTestEmailContentTemplate prefers input.toEmail over fallback recipient', async () => {
    const { service, renderer, emailService } = createService();
    renderer.preview.mockResolvedValue({
      subject: 'Subject',
      html: '<p>h</p>',
      text: 't',
      missingPlaceholders: [],
      warnings: [],
    });
    emailService.send.mockResolvedValue({ id: 'msg-2' });

    await service.sendTestEmailContentTemplate(
      { key: EmailTemplateKey.PASSWORD_RESET, toEmail: 'qa@example.com' },
      'admin@sopet.org',
    );

    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'qa@example.com', forceSend: true }),
    );
  });

  it('sendTestEmailContentTemplate throws EMAIL_TEST_SEND_FAILED and never claims success on transport failure', async () => {
    const { service, renderer, emailService } = createService();
    renderer.preview.mockResolvedValue({
      subject: 'Subject',
      html: '<p>h</p>',
      text: 't',
      missingPlaceholders: [],
      warnings: [],
    });
    emailService.send.mockRejectedValue(new Error('Resend unavailable'));

    await expect(
      service.sendTestEmailContentTemplate(
        { key: EmailTemplateKey.PASSWORD_RESET },
        'admin@sopet.org',
      ),
    ).rejects.toMatchObject({ response: { code: 'EMAIL_TEST_SEND_FAILED' } });
  });
});
