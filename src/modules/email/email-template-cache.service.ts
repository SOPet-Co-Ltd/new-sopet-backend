import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailContainer } from '../../database/entities/email-container.entity';
import { EmailContentTemplate } from '../../database/entities/email-content-template.entity';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';

export interface EmailTemplateCacheEntry {
  content: EmailContentTemplate | null;
  container: EmailContainer | null;
}

interface CacheRecord {
  entry: EmailTemplateCacheEntry;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * In-process TTL cache for content+container snapshots keyed by template key
 * (Design Doc § Cache Invalidation). Not shared across instances — accepted
 * MVP tradeoff per ADR-0011.
 */
@Injectable()
export class EmailTemplateCacheService {
  private readonly ttlMs: number;
  private readonly store = new Map<EmailTemplateKey, CacheRecord>();

  constructor(private readonly configService: ConfigService) {
    this.ttlMs = this.configService.get<number>('email.templateCacheTtlMs') ?? DEFAULT_TTL_MS;
  }

  get(key: EmailTemplateKey): EmailTemplateCacheEntry | undefined {
    const record = this.store.get(key);
    if (!record) {
      return undefined;
    }
    if (Date.now() >= record.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return record.entry;
  }

  set(key: EmailTemplateKey, entry: EmailTemplateCacheEntry): void {
    this.store.set(key, { entry, expiresAt: Date.now() + this.ttlMs });
  }

  invalidateKey(key: EmailTemplateKey): void {
    this.store.delete(key);
  }

  invalidateAll(): void {
    this.store.clear();
  }
}
