import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
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
  constructor(private readonly emailCmsService: EmailCmsService) {}

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
    @Args('input') input: CreateEmailContainerInput,
  ): Promise<EmailContainerType> {
    const { container, warnings } = await this.emailCmsService.createContainer(input);
    return mapContainer(container, warnings);
  }

  @Mutation(() => EmailContainerType)
  async updateEmailContainer(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateEmailContainerInput,
  ): Promise<EmailContainerType> {
    const { container, warnings } = await this.emailCmsService.updateContainer(id, input);
    return mapContainer(container, warnings);
  }

  @Mutation(() => EmailContainerType)
  async setDefaultEmailContainer(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<EmailContainerType> {
    const { container, warnings } = await this.emailCmsService.setDefaultContainer(id);
    return mapContainer(container, warnings);
  }

  @Mutation(() => EmailContentTemplateType)
  async updateEmailContentTemplate(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateEmailContentTemplateInput,
  ): Promise<EmailContentTemplateType> {
    const { content, warnings } = await this.emailCmsService.updateContentTemplate(id, input);
    const withContainer = await this.emailCmsService.getContentTemplate(content.id);
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
