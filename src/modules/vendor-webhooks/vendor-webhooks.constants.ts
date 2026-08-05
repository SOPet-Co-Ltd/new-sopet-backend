import type { VendorWebhookEvent } from '../../database/entities/store-webhook.entity';

export const VENDOR_WEBHOOK_QUEUE = 'vendor-webhooks';

export type VendorWebhookJobData = {
  deliveryId: string;
  storeId: string;
  event: VendorWebhookEvent;
  url: string;
  secret: string;
  payloadJson: string;
};
