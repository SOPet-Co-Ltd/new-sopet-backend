import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';

/**
 * Code-owned placeholder contract per email template key (Design Doc §
 * Placeholder Registry). Not admin-editable in MVP. `EmailDeliveryService`
 * must build exactly these variable names for each key; `EmailCmsService`
 * uses this registry to block unknown `{{vars}}` on save.
 */
export interface EmailPlaceholderInfo {
  name: string;
  /** true = substituted raw (server-built only); false = HTML-escaped scalar */
  trustedHtml: boolean;
  required: boolean;
  sample: string;
}

/** System placeholders available inside container `htmlShell`s (not per-key). */
export const EMAIL_SYSTEM_PLACEHOLDERS: EmailPlaceholderInfo[] = [
  {
    name: 'logoUrl',
    trustedHtml: false,
    required: true,
    sample: 'https://sopet.co.th/images/email/sopet-logo-white.png',
  },
];

const REGISTRY: Record<EmailTemplateKey, EmailPlaceholderInfo[]> = {
  [EmailTemplateKey.VENDOR_INVITE]: [
    {
      name: 'inviteUrl',
      trustedHtml: false,
      required: true,
      sample: 'https://admin.sopet.co.th/register?token=sample-token',
    },
  ],
  [EmailTemplateKey.ADMIN_INVITE]: [
    {
      name: 'inviteUrl',
      trustedHtml: false,
      required: true,
      sample: 'https://admin.sopet.co.th/register/invite/admin?token=sample-token',
    },
  ],
  [EmailTemplateKey.STORE_MEMBER_INVITE]: [
    {
      name: 'inviteUrl',
      trustedHtml: false,
      required: true,
      sample: 'https://admin.sopet.co.th/invite/store?token=sample-token',
    },
    {
      name: 'storeName',
      trustedHtml: false,
      required: true,
      sample: 'ร้านตัวอย่าง',
    },
  ],
  [EmailTemplateKey.PASSWORD_RESET]: [
    {
      name: 'resetUrl',
      trustedHtml: false,
      required: true,
      sample: 'https://admin.sopet.co.th/reset-password?token=sample-token',
    },
  ],
  [EmailTemplateKey.EMAIL_VERIFICATION]: [
    {
      name: 'verifyUrl',
      trustedHtml: false,
      required: true,
      sample: 'https://admin.sopet.co.th/verify-email?token=sample-token',
    },
  ],
  [EmailTemplateKey.ORDER_PAID]: [
    { name: 'orderNumber', trustedHtml: false, required: true, sample: 'ORD-000123' },
    { name: 'orderDate', trustedHtml: false, required: true, sample: '1 ม.ค. 2569' },
    { name: 'paymentMethod', trustedHtml: false, required: true, sample: 'พร้อมเพย์' },
    { name: 'customerName', trustedHtml: false, required: false, sample: 'คุณลูกค้าตัวอย่าง' },
    { name: 'subtotal', trustedHtml: false, required: true, sample: '฿1,000' },
    { name: 'discountAmount', trustedHtml: false, required: false, sample: '฿0' },
    { name: 'shippingFee', trustedHtml: false, required: true, sample: '฿50' },
    { name: 'total', trustedHtml: false, required: true, sample: '฿1,050' },
    {
      name: 'orderUrl',
      trustedHtml: false,
      required: true,
      sample: 'https://sopet.co.th/user/orders/sample',
    },
    {
      name: 'itemsHtml',
      trustedHtml: true,
      required: true,
      sample: '<tr><td>สินค้าตัวอย่าง x1</td></tr>',
    },
  ],
  [EmailTemplateKey.ORDER_STATUS_CHANGED]: [
    { name: 'orderNumber', trustedHtml: false, required: true, sample: 'ORD-000123' },
    { name: 'status', trustedHtml: false, required: false, sample: 'shipped' },
    { name: 'statusLabel', trustedHtml: false, required: true, sample: 'จัดส่งแล้ว' },
    { name: 'orderDate', trustedHtml: false, required: false, sample: '1 ม.ค. 2569' },
    {
      name: 'orderUrl',
      trustedHtml: false,
      required: true,
      sample: 'https://sopet.co.th/user/orders/sample',
    },
  ],
  [EmailTemplateKey.VENDOR_ACCOUNT_SUSPENDED]: [
    { name: 'vendorName', trustedHtml: false, required: false, sample: 'ผู้ขายตัวอย่าง' },
    { name: 'storeName', trustedHtml: false, required: false, sample: 'ร้านตัวอย่าง' },
  ],
};

export function getPlaceholdersForKey(key: EmailTemplateKey): EmailPlaceholderInfo[] {
  return REGISTRY[key] ?? [];
}

export function getTrustedPlaceholderNames(key: EmailTemplateKey): Set<string> {
  return new Set(
    getPlaceholdersForKey(key)
      .filter((p) => p.trustedHtml)
      .map((p) => p.name),
  );
}

export function getContainerSystemPlaceholders(): EmailPlaceholderInfo[] {
  return EMAIL_SYSTEM_PLACEHOLDERS;
}
