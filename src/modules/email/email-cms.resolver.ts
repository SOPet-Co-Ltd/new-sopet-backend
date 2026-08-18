import { UseGuards } from '@nestjs/common';
import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EmailContainer } from '../../database/entities/email-container.entity';
import { EmailContentTemplate } from '../../database/entities/email-content-template.entity';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import { EmailCmsService } from './email-cms.service';
import { getPlaceholdersForKey } from './email-template-registry';
import {
  CreateEmailContainerInput,
  PreviewEmailContentTemplateInput,
  SendTestEmailContentTemplateInput,
  UpdateEmailContainerInput,
  UpdateEmailContentTemplateInput,
} from './email-cms.inputs';
import {
  EmailContainerType,
  EmailContentTemplateType,
  EmailPreviewResultType,
} from './email-cms.types';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { getAuditRequestContext } from '../audit-logs/audit-request-context';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

function mapContainer(container: EmailContainer, warnings: string[] = []): EmailContainerType {
  return {
    id: container.id,
    name: container.name,
    htmlShell: container.htmlShell,
    isDefault: container.isDefault,
    createdAt: container.createdAt,
    updatedAt: container.updatedAt,
    warnings,
  };
}

function mapContentTemplate(
  content: EmailContentTemplate,
  warnings: string[] = [],
): EmailContentTemplateType {
  return {
    id: content.id,
    key: content.key,
    name: content.name,
    subjectTemplate: content.subjectTemplate,
    bodyHtml: content.bodyHtml,
    textTemplate: content.textTemplate,
    containerId: content.containerId,
    container: content.container ? mapContainer(content.container) : (undefined as never),
    enabled: content.enabled,
    allowedPlaceholders: getPlaceholdersForKey(content.key),
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
    warnings,
  };
}

/** Admin-only Email CMS surface (Design Doc § GraphQL Admin API Sketch). */
@Resolver()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class EmailCmsResolver {
  constructor(
    private readonly emailCmsService: EmailCmsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  @Query(() => [EmailContainerType])
  async emailContainers(): Promise<EmailContainerType[]> {
    const containers = await this.emailCmsService.listContainers();
    return containers.map((c) => mapContainer(c));
  }

  @Query(() => EmailContainerType, { nullable: true })
  async emailContainer(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<EmailContainerType | null> {
    const container = await this.emailCmsService.getContainer(id);
    return container ? mapContainer(container) : null;
  }

  @Query(() => [EmailContentTemplateType])
  async emailContentTemplates(): Promise<EmailContentTemplateType[]> {
    const templates = await this.emailCmsService.listContentTemplates();
    return templates.map((t) => mapContentTemplate(t));
  }

  @Query(() => EmailContentTemplateType, { nullable: true })
  async emailContentTemplate(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<EmailContentTemplateType | null> {
    const template = await this.emailCmsService.getContentTemplate(id);
    return template ? mapContentTemplate(template) : null;
  }

  @Query(() => EmailContentTemplateType, { nullable: true })
  async emailContentTemplateByKey(
    @Args('key', { type: () => EmailTemplateKey }) key: EmailTemplateKey,
  ): Promise<EmailContentTemplateType | null> {
    const template = await this.emailCmsService.getContentTemplateByKey(key);
    return template ? mapContentTemplate(template) : null;
  }

  @Mutation(() => EmailContainerType)
  async createEmailContainer(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: CreateEmailContainerInput,
    @Context() context?: GraphqlContext,
  ): Promise<EmailContainerType> {
    const { container, warnings } = await this.emailCmsService.createContainer(input);
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.EMAIL_CONTAINER_CREATED,
      resourceType: AuditResourceType.EMAIL,
      resourceId: container.id,
      metadata: { isDefault: container.isDefault },
      ...getAuditRequestContext(context?.req),
    });
    return mapContainer(container, warnings);
  }

  @Mutation(() => EmailContainerType)
  async updateEmailContainer(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateEmailContainerInput,
    @Context() context?: GraphqlContext,
  ): Promise<EmailContainerType> {
    const { container, warnings } = await this.emailCmsService.updateContainer(id, input);
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.EMAIL_CONTAINER_UPDATED,
      resourceType: AuditResourceType.EMAIL,
      resourceId: container.id,
      metadata: { isDefault: container.isDefault },
      ...getAuditRequestContext(context?.req),
    });
    return mapContainer(container, warnings);
  }

  @Mutation(() => EmailContainerType)
  async setDefaultEmailContainer(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id', { type: () => ID }) id: string,
    @Context() context?: GraphqlContext,
  ): Promise<EmailContainerType> {
    const { container, warnings } = await this.emailCmsService.setDefaultContainer(id);
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.EMAIL_CONTAINER_DEFAULT_SET,
      resourceType: AuditResourceType.EMAIL,
      resourceId: container.id,
      metadata: { isDefault: container.isDefault },
      ...getAuditRequestContext(context?.req),
    });
    return mapContainer(container, warnings);
  }

  @Mutation(() => EmailContentTemplateType)
  async updateEmailContentTemplate(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateEmailContentTemplateInput,
    @Context() context?: GraphqlContext,
  ): Promise<EmailContentTemplateType> {
    const { content, warnings } = await this.emailCmsService.updateContentTemplate(id, input);
    const withContainer = await this.emailCmsService.getContentTemplate(content.id);
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.EMAIL_CONTENT_TEMPLATE_UPDATED,
      resourceType: AuditResourceType.EMAIL,
      resourceId: content.id,
      metadata: { key: content.key },
      ...getAuditRequestContext(context?.req),
    });
    return mapContentTemplate(withContainer ?? content, warnings);
  }

  @Mutation(() => EmailPreviewResultType)
  async previewEmailContentTemplate(
    @Args('input') input: PreviewEmailContentTemplateInput,
  ): Promise<EmailPreviewResultType> {
    return this.emailCmsService.previewContentTemplate(input);
  }

  @Mutation(() => Boolean)
  async sendTestEmailContentTemplate(
    @Args('input') input: SendTestEmailContentTemplateInput,
    @CurrentUser('email') adminEmail: string,
  ): Promise<boolean> {
    return this.emailCmsService.sendTestEmailContentTemplate(input, adminEmail);
  }
}
