import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailContainer } from '../../database/entities/email-container.entity';
import { EmailContentTemplate } from '../../database/entities/email-content-template.entity';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import { EmailService } from './email.service';
import { EmailTemplateCacheService } from './email-template-cache.service';
import {
  EmailPreviewResult,
  EmailTemplateRendererService,
} from './email-template-renderer.service';
import { validateContainerHtmlShell, validateEmailContentTemplate } from './email-html-validation';
import {
  CreateEmailContainerInput,
  PreviewEmailContentTemplateInput,
  SendTestEmailContentTemplateInput,
  UpdateEmailContainerInput,
  UpdateEmailContentTemplateInput,
} from './email-cms.inputs';

export interface EmailContainerSaveResult {
  container: EmailContainer;
  warnings: string[];
}

export interface EmailContentTemplateSaveResult {
  content: EmailContentTemplate;
  warnings: string[];
}

function parseVariablesJson(variablesJson?: string): Record<string, string> {
  if (!variablesJson) return {};
  try {
    const parsed: unknown = JSON.parse(variablesJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[key] = String(value);
    }
    return result;
  } catch {
    throw new BadRequestException({
      code: 'EMAIL_INVALID_VARIABLES_JSON',
      message: 'variablesJson must be a JSON-encoded object of string values',
    });
  }
}

@Injectable()
export class EmailCmsService {
  private readonly logger = new Logger(EmailCmsService.name);

  constructor(
    @InjectRepository(EmailContainer)
    private readonly containerRepo: Repository<EmailContainer>,
    @InjectRepository(EmailContentTemplate)
    private readonly contentRepo: Repository<EmailContentTemplate>,
    private readonly cache: EmailTemplateCacheService,
    private readonly renderer: EmailTemplateRendererService,
    private readonly emailService: EmailService,
  ) {}

  // ---- Containers ----------------------------------------------------

  async listContainers(): Promise<EmailContainer[]> {
    return this.containerRepo.find({ order: { isDefault: 'DESC', name: 'ASC' } });
  }

  async getContainer(id: string): Promise<EmailContainer | null> {
    return this.containerRepo.findOne({ where: { id } });
  }

  async createContainer(input: CreateEmailContainerInput): Promise<EmailContainerSaveResult> {
    const { errors, warnings } = validateContainerHtmlShell(input.htmlShell);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: errors[0].code,
        message: errors.map((e) => e.message).join('; '),
      });
    }

    if (input.isDefault) {
      await this.containerRepo.update({ isDefault: true }, { isDefault: false });
    }

    const container = await this.containerRepo.save(
      this.containerRepo.create({
        name: input.name,
        htmlShell: input.htmlShell,
        isDefault: input.isDefault ?? false,
      }),
    );

    this.cache.invalidateAll();
    this.logger.log(`Email container created id=${container.id}`);
    return { container, warnings };
  }

  async updateContainer(
    id: string,
    input: UpdateEmailContainerInput,
  ): Promise<EmailContainerSaveResult> {
    const existing = await this.containerRepo.findOne({ where: { id } });
    if (!existing) {
      throw new BadRequestException({
        code: 'EMAIL_TEMPLATE_NOT_FOUND',
        message: `Email container ${id} not found`,
      });
    }

    const nextHtmlShell = input.htmlShell ?? existing.htmlShell;
    const { errors, warnings } = validateContainerHtmlShell(nextHtmlShell);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: errors[0].code,
        message: errors.map((e) => e.message).join('; '),
      });
    }

    if (input.isDefault === false && existing.isDefault) {
      throw new BadRequestException({
        code: 'EMAIL_DEFAULT_CONTAINER_REQUIRED',
        message: 'Set another container as default before clearing this one',
      });
    }

    if (input.isDefault === true && !existing.isDefault) {
      await this.containerRepo.update({ isDefault: true }, { isDefault: false });
    }

    existing.name = input.name ?? existing.name;
    existing.htmlShell = nextHtmlShell;
    existing.isDefault = input.isDefault ?? existing.isDefault;

    const container = await this.containerRepo.save(existing);
    this.cache.invalidateAll();
    this.logger.log(`Email container updated id=${container.id}`);
    return { container, warnings };
  }

  async setDefaultContainer(id: string): Promise<EmailContainerSaveResult> {
    const existing = await this.containerRepo.findOne({ where: { id } });
    if (!existing) {
      throw new BadRequestException({
        code: 'EMAIL_TEMPLATE_NOT_FOUND',
        message: `Email container ${id} not found`,
      });
    }

    await this.containerRepo.update({ isDefault: true }, { isDefault: false });
    existing.isDefault = true;
    const container = await this.containerRepo.save(existing);

    this.cache.invalidateAll();
    this.logger.log(`Email container set as default id=${container.id}`);
    return { container, warnings: [] };
  }

  // ---- Content templates ----------------------------------------------

  async listContentTemplates(): Promise<EmailContentTemplate[]> {
    return this.contentRepo.find({ relations: ['container'], order: { key: 'ASC' } });
  }

  async getContentTemplate(id: string): Promise<EmailContentTemplate | null> {
    return this.contentRepo.findOne({ where: { id }, relations: ['container'] });
  }

  async getContentTemplateByKey(key: EmailTemplateKey): Promise<EmailContentTemplate | null> {
    return this.contentRepo.findOne({ where: { key }, relations: ['container'] });
  }

  async updateContentTemplate(
    id: string,
    input: UpdateEmailContentTemplateInput,
  ): Promise<EmailContentTemplateSaveResult> {
    const existing = await this.contentRepo.findOne({ where: { id } });
    if (!existing) {
      throw new BadRequestException({
        code: 'EMAIL_TEMPLATE_NOT_FOUND',
        message: `Email content template ${id} not found`,
      });
    }

    if (input.containerId && input.containerId !== existing.containerId) {
      const container = await this.containerRepo.findOne({ where: { id: input.containerId } });
      if (!container) {
        throw new BadRequestException({
          code: 'EMAIL_TEMPLATE_NOT_FOUND',
          message: `Email container ${input.containerId} not found`,
        });
      }
    }

    const nextFields = {
      subjectTemplate: input.subjectTemplate ?? existing.subjectTemplate,
      bodyHtml: input.bodyHtml ?? existing.bodyHtml,
      textTemplate: input.textTemplate ?? existing.textTemplate,
    };

    const { errors, warnings } = validateEmailContentTemplate(existing.key, nextFields);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: errors[0].code,
        message: errors.map((e) => e.message).join('; '),
      });
    }

    existing.name = input.name ?? existing.name;
    existing.subjectTemplate = nextFields.subjectTemplate;
    existing.bodyHtml = nextFields.bodyHtml;
    existing.textTemplate = nextFields.textTemplate;
    existing.containerId = input.containerId ?? existing.containerId;
    existing.enabled = input.enabled ?? existing.enabled;

    const content = await this.contentRepo.save(existing);
    this.cache.invalidateKey(existing.key);
    this.logger.log(`Email content template updated key=${content.key}`);
    return { content, warnings };
  }

  // ---- Preview / test send ---------------------------------------------

  async previewContentTemplate(
    input: PreviewEmailContentTemplateInput,
  ): Promise<EmailPreviewResult> {
    const variables = parseVariablesJson(input.variablesJson);

    if (input.bodyHtml !== undefined || input.subjectTemplate !== undefined) {
      // Same block/warn rules as save-time validation (Design Doc §
      // PreviewEmailContentTemplate contract: "BadRequest on blocked HTML /
      // unknown placeholders in buffers"). Missing *values* for known
      // placeholders are handled separately below via sample defaults +
      // `missingPlaceholders`, not treated as a validation error here.
      const { errors } = validateEmailContentTemplate(input.key, {
        subjectTemplate: input.subjectTemplate ?? '',
        bodyHtml: input.bodyHtml ?? '',
        textTemplate: input.textTemplate,
      });
      if (errors.length > 0) {
        throw new BadRequestException({
          code: errors[0].code,
          message: errors.map((e) => e.message).join('; '),
        });
      }
    }

    return this.renderer.preview({
      key: input.key,
      subjectTemplate: input.subjectTemplate,
      bodyHtml: input.bodyHtml,
      textTemplate: input.textTemplate,
      containerId: input.containerId,
      variables,
    });
  }

  async sendTestEmailContentTemplate(
    input: SendTestEmailContentTemplateInput,
    fallbackRecipientEmail: string,
  ): Promise<boolean> {
    const to = (input.toEmail?.trim() || fallbackRecipientEmail || '').trim();
    if (!to) {
      throw new BadRequestException({
        code: 'EMAIL_TEST_SEND_FAILED',
        message: 'A recipient email address is required for test send',
      });
    }

    const preview = await this.previewContentTemplate({
      key: input.key,
      subjectTemplate: input.subjectTemplate,
      bodyHtml: input.bodyHtml,
      textTemplate: input.textTemplate,
      containerId: input.containerId,
      variablesJson: input.variablesJson,
    });

    try {
      await this.emailService.send({
        to,
        subject: `[ทดสอบ] ${preview.subject}`,
        html: preview.html,
        text: preview.text,
        forceSend: true,
      });
      this.logger.log(`Test email sent key=${input.key} to=${to}`);
      return true;
    } catch (error) {
      throw new BadRequestException({
        code: 'EMAIL_TEST_SEND_FAILED',
        message: error instanceof Error ? error.message : 'Failed to send test email',
      });
    }
  }
}
