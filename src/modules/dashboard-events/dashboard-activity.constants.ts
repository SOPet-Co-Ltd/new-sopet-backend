export enum DashboardActivityKind {
  ORDER = 'ORDER',
  BANK_TRANSFER = 'BANK_TRANSFER',
  STORE_REQUEST = 'STORE_REQUEST',
  STORE_STATUS = 'STORE_STATUS',
  REACTIVATION = 'REACTIVATION',
  TAXONOMY = 'TAXONOMY',
  PAYOUT = 'PAYOUT',
  REVIEW = 'REVIEW',
}

export type DashboardActivityRole = 'admin' | 'vendor';

export type DashboardActivityEvent = {
  kind: DashboardActivityKind;
  entityId: string;
  storeId?: string | null;
  userIds?: string[];
  roles?: DashboardActivityRole[];
};

export const DASHBOARD_ACTIVITY = 'dashboardActivity';

export type DashboardActivityPayload = {
  dashboardActivity: DashboardActivityEvent;
};
