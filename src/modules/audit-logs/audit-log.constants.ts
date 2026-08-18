export const AuditAction = {
  LOGIN: 'auth.login',
  PASSWORD_RESET_SENT: 'auth.password_reset_sent',
  EMAIL_VERIFICATION_SENT: 'auth.email_verification_sent',
  EMAIL_VERIFIED: 'auth.email_verified',
  VENDOR_UPDATED: 'vendor.updated',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_STATUS_CHANGED: 'customer.status_changed',
  STORE_CREATED: 'store.created',
  STORE_UPDATED: 'store.updated',
  STORE_OWNER_CHANGED: 'store.owner_changed',
  STORE_SUSPENDED: 'store.suspended',
  STORE_REACTIVATED: 'store.reactivated',
  STORE_APPROVED: 'store.approved',
  STORE_REJECTED: 'store.rejected',
  PAYOUT_TRIGGERED: 'payout.triggered',
  PAYOUT_MANUAL_SETTLED: 'payout.manual_settled',
  PAYOUT_MANUAL_REJECTED: 'payout.manual_rejected',
  ADMIN_INVITED: 'admin.invited',
  ADMIN_INVITATION_REVOKED: 'admin.invitation_revoked',
  ADMIN_INVITATION_ACCEPTED: 'admin.invitation_accepted',
  ADMIN_STATUS_CHANGED: 'admin.status_changed',
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditResourceType = {
  USER: 'user',
  VENDOR: 'vendor',
  CUSTOMER: 'customer',
  STORE: 'store',
  PAYOUT: 'payout',
  ADMIN_INVITATION: 'admin_invitation',
} as const;

export type AuditResourceTypeValue = (typeof AuditResourceType)[keyof typeof AuditResourceType];
