export enum EmailTemplateKey {
  VENDOR_INVITE = 'vendor_invite',
  ADMIN_INVITE = 'admin_invite',
  STORE_MEMBER_INVITE = 'store_member_invite',
  PASSWORD_RESET = 'password_reset',
  EMAIL_VERIFICATION = 'email_verification',
  ORDER_PAID = 'order_paid',
  ORDER_STATUS_CHANGED = 'order_status_changed',
  VENDOR_ACCOUNT_SUSPENDED = 'vendor_account_suspended',
}

export const EMAIL_TEMPLATE_KEYS: EmailTemplateKey[] = Object.values(EmailTemplateKey);
