import { Reflector } from '@nestjs/core';
import { EmailCmsResolver } from './email-cms.resolver';
import { EmailCmsService } from './email-cms.service';
import { ROLES_KEY } from '../../common/decorators';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@sopet.org';
const CONTAINER_ID = '12121212-1212-4121-8121-121212121212';
const CONTENT_ID = '13131313-1313-4131-8131-131313131313';

const graphqlContext: GraphqlContext = {
  req: { requestId: 'req-email-1', headers: { 'x-forwarded-for': '203.0.113.10' } },
  res: {},
  loaders: { productSoldCount: { load: jest.fn() } as never },
};

const now = new Date('2026-01-01T00:00:00Z');

function container(isDefault = true) {
  return {
    id: CONTAINER_ID,
    name: 'Default shell',
    htmlShell: '<html>{{{content}}}</html>',
    isDefault,
    createdAt: now,
    updatedAt: now,
  };
}

function contentTemplate() {
  return {
    id: CONTENT_ID,
    key: EmailTemplateKey.ADMIN_INVITE,
    name: 'Admin invite',
    subjectTemplate: 'Invite',
    bodyHtml: '<p>Hello</p>',
    textTemplate: 'Hello',
    containerId: CONTAINER_ID,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('EmailCmsResolver — authz', () => {
  it('requires the admin role on the whole resolver (light authz check)', () => {
    const reflector = new Reflector();
    const roles = reflector.get<string[]>(ROLES_KEY, EmailCmsResolver);
    expect(roles).toEqual(['admin']);
  });
});

describe('EmailCmsResolver audit logging (AC-B-005)', () => {
  let resolver: EmailCmsResolver;
  let emailCmsService: {
    createContainer: jest.Mock;
    updateContainer: jest.Mock;
    setDefaultContainer: jest.Mock;
    updateContentTemplate: jest.Mock;
    getContentTemplate: jest.Mock;
    previewContentTemplate: jest.Mock;
    sendTestEmailContentTemplate: jest.Mock;
  };
  let auditLogsService: { log: jest.Mock };

  beforeEach(() => {
    emailCmsService = {
      createContainer: jest.fn(),
      updateContainer: jest.fn(),
      setDefaultContainer: jest.fn(),
      updateContentTemplate: jest.fn(),
      getContentTemplate: jest.fn(),
      previewContentTemplate: jest.fn(),
      sendTestEmailContentTemplate: jest.fn(),
    };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    resolver = new EmailCmsResolver(
      emailCmsService as unknown as EmailCmsService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  it('logs email.container.created once', async () => {
    emailCmsService.createContainer.mockResolvedValue({
      container: container(false),
      warnings: [],
    });

    await resolver.createEmailContainer(
      ADMIN_ID,
      ADMIN_EMAIL,
      { name: 'Default shell', htmlShell: '<html>{{{content}}}</html>' },
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        actorId: ADMIN_ID,
        actorLabel: ADMIN_EMAIL,
        action: AuditAction.EMAIL_CONTAINER_CREATED,
        resourceType: AuditResourceType.EMAIL,
        resourceId: CONTAINER_ID,
        metadata: { isDefault: false },
        requestId: 'req-email-1',
      }),
    );
  });

  it('logs email.container.updated once', async () => {
    emailCmsService.updateContainer.mockResolvedValue({
      container: container(true),
      warnings: [],
    });

    await resolver.updateEmailContainer(
      ADMIN_ID,
      ADMIN_EMAIL,
      CONTAINER_ID,
      { name: 'Renamed' },
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EMAIL_CONTAINER_UPDATED,
        resourceType: AuditResourceType.EMAIL,
        resourceId: CONTAINER_ID,
        metadata: { isDefault: true },
      }),
    );
  });

  it('logs email.container.default_set once', async () => {
    emailCmsService.setDefaultContainer.mockResolvedValue({
      container: container(true),
      warnings: [],
    });

    await resolver.setDefaultEmailContainer(ADMIN_ID, ADMIN_EMAIL, CONTAINER_ID, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EMAIL_CONTAINER_DEFAULT_SET,
        resourceType: AuditResourceType.EMAIL,
        resourceId: CONTAINER_ID,
        metadata: { isDefault: true },
      }),
    );
  });

  it('logs email.content_template.updated with key metadata and no html body', async () => {
    const content = contentTemplate();
    emailCmsService.updateContentTemplate.mockResolvedValue({ content, warnings: [] });
    emailCmsService.getContentTemplate.mockResolvedValue(content);

    await resolver.updateEmailContentTemplate(
      ADMIN_ID,
      ADMIN_EMAIL,
      CONTENT_ID,
      { name: 'Admin invite' },
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EMAIL_CONTENT_TEMPLATE_UPDATED,
        resourceType: AuditResourceType.EMAIL,
        resourceId: CONTENT_ID,
        metadata: { key: EmailTemplateKey.ADMIN_INVITE },
      }),
    );
  });

  it('does not log previewEmailContentTemplate', async () => {
    emailCmsService.previewContentTemplate.mockResolvedValue({
      subject: 's',
      html: '<p>x</p>',
      text: 'x',
    });

    await resolver.previewEmailContentTemplate({ key: EmailTemplateKey.ADMIN_INVITE });

    expect(emailCmsService.previewContentTemplate).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).not.toHaveBeenCalled();
  });

  it('does not log sendTestEmailContentTemplate', async () => {
    emailCmsService.sendTestEmailContentTemplate.mockResolvedValue(true);

    await resolver.sendTestEmailContentTemplate(
      { key: EmailTemplateKey.ADMIN_INVITE },
      ADMIN_EMAIL,
    );

    expect(emailCmsService.sendTestEmailContentTemplate).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).not.toHaveBeenCalled();
  });
});
