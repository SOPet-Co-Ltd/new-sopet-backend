import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import {
  StoreWebhook,
  VENDOR_WEBHOOK_EVENTS,
  VendorWebhookEvent,
} from '../../database/entities/store-webhook.entity';
import {
  fetchWithPinnedIp,
  resolveSafeOutboundUrl,
  SafeUrlPin,
  UnsafeOutboundUrlError,
} from '../../common/utils/safe-fetch.util';
import { buildVendorWebhookOrderPayload, signVendorWebhookPayload } from './vendor-webhook.payload';
import { DEFAULT_VENDOR_WEBHOOK_EVENTS } from './vendor-webhook.events';
import { VENDOR_WEBHOOK_QUEUE, VendorWebhookJobData } from './vendor-webhooks.constants';

export type StoreWebhookPublicView = {
  id: string;
  url: string;
  enabled: boolean;
  events: VendorWebhookEvent[];
  hasSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Present only when secret was just created or rotated. */
  secret?: string;
};

@Injectable()
export class VendorWebhooksService {
  private readonly logger = new Logger(VendorWebhooksService.name);

  constructor(
    @InjectRepository(StoreWebhook)
    private readonly webhookRepository: Repository<StoreWebhook>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @Optional()
    @InjectQueue(VENDOR_WEBHOOK_QUEUE)
    private readonly queue?: Queue<VendorWebhookJobData>,
  ) {}

  async getForStore(storeId: string): Promise<StoreWebhookPublicView | null> {
    const webhook = await this.webhookRepository.findOne({ where: { storeId } });
    if (!webhook) {
      return null;
    }
    return this.toPublicView(webhook);
  }

  async upsertForStore(
    storeId: string,
    input: {
      url: string;
      events?: VendorWebhookEvent[];
      enabled?: boolean;
      rotateSecret?: boolean;
    },
  ): Promise<StoreWebhookPublicView> {
    await this.assertSafeWebhookUrl(input.url);
    const events = this.normalizeEvents(input.events);
    const existing = await this.webhookRepository.findOne({ where: { storeId } });

    if (!existing) {
      const secret = this.generateSecret();
      const created = await this.webhookRepository.save(
        this.webhookRepository.create({
          storeId,
          url: input.url.trim(),
          secret,
          enabled: input.enabled ?? true,
          events,
        }),
      );
      return this.toPublicView(created, secret);
    }

    const rotate = input.rotateSecret === true;
    const nextSecret = rotate ? this.generateSecret() : existing.secret;
    existing.url = input.url.trim();
    existing.events = events;
    if (input.enabled !== undefined) {
      existing.enabled = input.enabled;
    }
    if (rotate) {
      existing.secret = nextSecret;
    }

    const saved = await this.webhookRepository.save(existing);
    return this.toPublicView(saved, rotate ? nextSecret : undefined);
  }

  async deleteForStore(storeId: string): Promise<void> {
    const existing = await this.webhookRepository.findOne({ where: { storeId } });
    if (!existing) {
      throw new NotFoundException({
        code: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook not configured for this store',
      });
    }
    await this.webhookRepository.remove(existing);
  }

  /**
   * Best-effort dispatch for every store on the order that has the event enabled.
   * Never throws to callers — failures are logged / retried in the queue.
   */
  async dispatchOrderEvent(orderId: string, event: VendorWebhookEvent): Promise<void> {
    try {
      const order = await this.orderRepository.findOne({
        where: { id: orderId },
        relations: ['items', 'items.productVariant', 'shippingAddress', 'customer'],
      });
      if (!order?.items?.length) {
        return;
      }

      const storeIds = [...new Set(order.items.map((item) => item.storeId))];
      for (const storeId of storeIds) {
        await this.dispatchForStore(order, storeId, event);
      }
    } catch (error) {
      this.logger.warn(
        `Vendor webhook dispatch failed for order=${orderId} event=${event}`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  private async dispatchForStore(
    order: Order,
    storeId: string,
    event: VendorWebhookEvent,
  ): Promise<void> {
    const webhook = await this.webhookRepository.findOne({ where: { storeId } });
    if (!webhook || !webhook.enabled || !webhook.events.includes(event)) {
      return;
    }

    const payload = buildVendorWebhookOrderPayload(order, storeId, event);
    if (!payload) {
      return;
    }

    const payloadJson = JSON.stringify(payload);
    const deliveryId = payload.id;
    const job: VendorWebhookJobData = {
      deliveryId,
      storeId,
      event,
      url: webhook.url,
      secret: webhook.secret,
      payloadJson,
    };

    if (this.queue) {
      await this.queue.add('deliver', job, {
        jobId: `${storeId}:${event}:${order.id}:${deliveryId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
      return;
    }

    // Redis unavailable — fire-and-forget single attempt.
    void this.deliverNow(job).catch((error: unknown) => {
      this.logger.warn(
        `Inline webhook delivery failed store=${storeId} event=${event}`,
        error instanceof Error ? error.message : undefined,
      );
    });
  }

  async deliverNow(job: VendorWebhookJobData): Promise<void> {
    // Defense in depth: re-validate + DNS-pin before every outbound fetch (SSRF / rebinding).
    const pin = await this.assertSafeWebhookUrl(job.url);

    const signature = signVendorWebhookPayload(job.secret, job.payloadJson);
    const response = await fetchWithPinnedIp(pin, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SOPET-VendorWebhook/1.0',
        'X-Sopet-Event': job.event,
        'X-Sopet-Delivery-Id': job.deliveryId,
        'X-Sopet-Signature': signature,
      },
      body: job.payloadJson,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Webhook endpoint returned HTTP ${response.status}`);
    }
  }

  private toPublicView(webhook: StoreWebhook, secret?: string): StoreWebhookPublicView {
    return {
      id: webhook.id,
      url: webhook.url,
      enabled: webhook.enabled,
      events: webhook.events,
      hasSecret: Boolean(webhook.secret),
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
      ...(secret ? { secret } : {}),
    };
  }

  private generateSecret(): string {
    return `whsec_${randomBytes(24).toString('hex')}`;
  }

  private normalizeEvents(events?: VendorWebhookEvent[]): VendorWebhookEvent[] {
    if (!events || events.length === 0) {
      return [...DEFAULT_VENDOR_WEBHOOK_EVENTS];
    }
    const unique = [...new Set(events)];
    for (const event of unique) {
      if (!VENDOR_WEBHOOK_EVENTS.includes(event)) {
        throw new BadRequestException({
          code: 'INVALID_WEBHOOK_EVENT',
          message: `Unsupported webhook event: ${event}`,
        });
      }
    }
    return unique;
  }

  /**
   * HTTPS-only + DNS resolution must not target private/reserved IPs (A10 SSRF).
   * Returns a connect pin so deliverNow cannot rebind after check (BE2-010).
   */
  async assertSafeWebhookUrl(url: string): Promise<SafeUrlPin> {
    try {
      return await resolveSafeOutboundUrl(url, { protocols: ['https:'] });
    } catch (error) {
      if (error instanceof UnsafeOutboundUrlError) {
        throw new BadRequestException({
          code: 'INVALID_WEBHOOK_URL',
          message: mapWebhookUrlError(error.message),
        });
      }
      throw error;
    }
  }
}

function mapWebhookUrlError(message: string): string {
  if (message === 'URL is invalid') {
    return 'Webhook URL must be a valid HTTPS URL';
  }
  if (message.startsWith('URL must use')) {
    return 'Webhook URL must use HTTPS';
  }
  if (message === 'URL must not include credentials') {
    return 'Webhook URL must not include credentials';
  }
  if (message === 'URL host could not be resolved') {
    return 'Webhook URL host could not be resolved';
  }
  return 'Webhook URL host is not allowed';
}
