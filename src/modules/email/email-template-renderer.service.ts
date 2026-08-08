import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailContainer } from '../../database/entities/email-container.entity';
import { EmailContentTemplate } from '../../database/entities/email-content-template.entity';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import { EmailTemplateCacheEntry, EmailTemplateCacheService } from './email-template-cache.service';
import { getContainerSystemPlaceholders, getPlaceholdersForKey } from './email-template-registry';
import {
  htmlToPlaintext,
  injectContentSlot,
  substituteDoubleBraces,
} from './email-template-merge.util';
import {
  adminInviteTemplate,
  emailVerificationTemplate,
  EmailTemplateBrand,
  EmailTemplateResult,
  orderPaidTemplate,
  orderStatusChangedTemplate,
  passwordResetTemplate,
  storeMemberInviteTemplate,
  vendorAccountSuspendedTemplate,
  vendorInviteTemplate,
} from './email-templates';
import { resolveEmailLogoUrl } from './email-logo-url.util';

const FALLBACK_RENDERERS = {
  [EmailTemplateKey.VENDOR_INVITE]: vendorInviteTemplate,
  [EmailTemplateKey.ADMIN_INVITE]: adminInviteTemplate,
  [EmailTemplateKey.STORE_MEMBER_INVITE]: storeMemberInviteTemplate,
  [EmailTemplateKey.PASSWORD_RESET]: passwordResetTemplate,
  [EmailTemplateKey.EMAIL_VERIFICATION]: emailVerificationTemplate,
  [EmailTemplateKey.ORDER_PAID]: orderPaidTemplate,
  [EmailTemplateKey.ORDER_STATUS_CHANGED]: orderStatusChangedTemplate,
  [EmailTemplateKey.VENDOR_ACCOUNT_SUSPENDED]: vendorAccountSuspendedTemplate,
} satisfies Record<
  EmailTemplateKey,
  (brand: EmailTemplateBrand, params: never) => EmailTemplateResult
>;

export type EmailFallbackParams<K extends EmailTemplateKey> = Parameters<
  (typeof FALLBACK_RENDERERS)[K]
>[1];

export interface RenderForSendOptions<K extends EmailTemplateKey> {
  /** String vars merged into subject/body/text (including any trustedHtml keys, e.g. `itemsHtml`). */
  vars: Record<string, string>;
  /** Structured params passed to the legacy TS function when DB content is missing/disabled. */
  fallbackParams: EmailFallbackParams<K>;
}

export interface EmailPreviewInput {
  key: EmailTemplateKey;
  subjectTemplate?: string;
  bodyHtml?: string;
  textTemplate?: string;
  containerId?: string;
  variables?: Record<string, string>;
}

export interface EmailPreviewResult {
  subject: string;
  html: string;
  text: string;
  missingPlaceholders: string[];
  warnings: string[];
}

type FallbackReason = 'missing' | 'disabled' | 'container_missing';

/**
 * Merges DB-backed container + content templates (Design Doc § Merge
 * Algorithm), or falls back to `email-templates.ts` when the content row is
 * missing/disabled or its container cannot be resolved.
 */
@Injectable()
export class EmailTemplateRendererService {
  private readonly logger = new Logger(EmailTemplateRendererService.name);
  private readonly brand: EmailTemplateBrand;

  constructor(
    @InjectRepository(EmailContentTemplate)
    private readonly contentRepo: Repository<EmailContentTemplate>,
    @InjectRepository(EmailContainer)
    private readonly containerRepo: Repository<EmailContainer>,
    private readonly cache: EmailTemplateCacheService,
    private readonly configService: ConfigService,
  ) {
    this.brand = {
      logoUrl: resolveEmailLogoUrl({
        explicitLogoUrl: this.configService.get<string>('email.logoUrl'),
        apiUrl:
          this.configService.get<string>('app.apiUrl') ||
          process.env.API_URL?.replace(/\/$/, '') ||
          'http://localhost:3002',
      }),
    };
  }

  async renderForSend<K extends EmailTemplateKey>(
    key: K,
    options: RenderForSendOptions<K>,
  ): Promise<EmailTemplateResult> {
    const entry = await this.loadEntry(key);

    if (!entry.content) {
      return this.renderFallback(key, options.fallbackParams, 'missing');
    }
    if (!entry.content.enabled) {
      return this.renderFallback(key, options.fallbackParams, 'disabled');
    }

    let container = entry.container;
    if (!container || container.id !== entry.content.containerId) {
      container = await this.containerRepo.findOne({ where: { id: entry.content.containerId } });
    }
    if (!container) {
      container = await this.loadDefaultContainer();
    }
    if (!container) {
      return this.renderFallback(key, options.fallbackParams, 'container_missing');
    }

    return this.merge(entry.content, container, options.vars);
  }

  async preview(input: EmailPreviewInput): Promise<EmailPreviewResult> {
    const placeholders = getPlaceholdersForKey(input.key);
    const needsExisting =
      input.subjectTemplate === undefined ||
      input.bodyHtml === undefined ||
      input.containerId === undefined;
    const existing = needsExisting
      ? await this.contentRepo.findOne({ where: { key: input.key } })
      : null;

    const subjectTemplate = input.subjectTemplate ?? existing?.subjectTemplate ?? '';
    const bodyHtml = input.bodyHtml ?? existing?.bodyHtml ?? '';
    const textTemplate = input.textTemplate ?? existing?.textTemplate ?? '';
    const containerId = input.containerId ?? existing?.containerId;

    let container = containerId
      ? await this.containerRepo.findOne({ where: { id: containerId } })
      : null;
    if (!container) {
      container = await this.loadDefaultContainer();
    }
    if (!container) {
      return {
        subject: subjectTemplate,
        html: bodyHtml,
        text: textTemplate || htmlToPlaintext(bodyHtml),
        missingPlaceholders: [],
        warnings: ['No email container is available to render a preview'],
      };
    }

    const providedVars = input.variables ?? {};
    const missingPlaceholders: string[] = [];
    const vars: Record<string, string> = { ...providedVars };
    for (const placeholder of placeholders) {
      if (vars[placeholder.name] === undefined || vars[placeholder.name] === '') {
        if (placeholder.required) {
          missingPlaceholders.push(placeholder.name);
        }
        vars[placeholder.name] = providedVars[placeholder.name] ?? placeholder.sample;
      }
    }

    const trustedKeys = new Set(placeholders.filter((p) => p.trustedHtml).map((p) => p.name));
    const mergedVars = { ...vars, logoUrl: this.brand.logoUrl };

    const subject = substituteDoubleBraces(subjectTemplate, mergedVars, {
      escapeScalars: false,
      trustedKeys: new Set(),
    });
    const body = substituteDoubleBraces(bodyHtml, mergedVars, {
      escapeScalars: true,
      trustedKeys,
    });
    const text = textTemplate.trim()
      ? substituteDoubleBraces(textTemplate, mergedVars, {
          escapeScalars: false,
          trustedKeys: new Set(),
        })
      : htmlToPlaintext(body);

    const shellSubstituted = substituteDoubleBraces(container.htmlShell, mergedVars, {
      escapeScalars: true,
      trustedKeys: new Set(),
    });
    const html = injectContentSlot(shellSubstituted, body);

    return { subject, html, text, missingPlaceholders, warnings: [] };
  }

  private async loadEntry(key: EmailTemplateKey): Promise<EmailTemplateCacheEntry> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const content = await this.contentRepo.findOne({ where: { key } });
    const container = content
      ? await this.containerRepo.findOne({ where: { id: content.containerId } })
      : null;

    const entry: EmailTemplateCacheEntry = { content, container };
    this.cache.set(key, entry);
    return entry;
  }

  private async loadDefaultContainer(): Promise<EmailContainer | null> {
    return this.containerRepo.findOne({ where: { isDefault: true } });
  }

  private merge(
    content: EmailContentTemplate,
    container: EmailContainer,
    vars: Record<string, string>,
  ): EmailTemplateResult {
    const key = content.key;
    const registry = getPlaceholdersForKey(key);
    const trustedKeys = new Set(registry.filter((p) => p.trustedHtml).map((p) => p.name));
    const mergedVars: Record<string, string> = { ...vars, logoUrl: this.brand.logoUrl };
    // Fill unset optional registry placeholders with '' so no literal `{{name}}`
    // leaks into the sent email when a caller omits an optional var.
    for (const placeholder of registry) {
      if (!(placeholder.name in mergedVars)) {
        mergedVars[placeholder.name] = '';
      }
    }

    const subject = substituteDoubleBraces(content.subjectTemplate, mergedVars, {
      escapeScalars: false,
      trustedKeys: new Set(),
    });
    const body = substituteDoubleBraces(content.bodyHtml, mergedVars, {
      escapeScalars: true,
      trustedKeys,
    });
    const text = content.textTemplate?.trim()
      ? substituteDoubleBraces(content.textTemplate, mergedVars, {
          escapeScalars: false,
          trustedKeys: new Set(),
        })
      : htmlToPlaintext(body);

    const shellSubstituted = substituteDoubleBraces(container.htmlShell, mergedVars, {
      escapeScalars: true,
      trustedKeys: new Set(),
    });
    const html = injectContentSlot(shellSubstituted, body);

    return { subject, html, text };
  }

  private renderFallback<K extends EmailTemplateKey>(
    key: K,
    params: EmailFallbackParams<K>,
    reason: FallbackReason,
  ): EmailTemplateResult {
    this.logger.warn(`EMAIL_TEMPLATE_DB_FALLBACK key=${key} reason=${reason}`);
    const fn = FALLBACK_RENDERERS[key] as (
      brand: EmailTemplateBrand,
      p: EmailFallbackParams<K>,
    ) => EmailTemplateResult;
    return fn(this.brand, params);
  }

  /** Exposed for the CMS resolver's "which placeholders are allowed" panel. */
  getContainerSystemPlaceholders() {
    return getContainerSystemPlaceholders();
  }
}
