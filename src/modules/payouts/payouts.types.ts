export interface PayoutBreakdownFours {
  productSold: number;
  shippingFees: number;
  commissionAmount: number;
  commissionRate: number;
}

export interface PayoutSummary extends PayoutBreakdownFours {
  storeId: string;
  grossRevenue: number;
  totalPaidOut: number;
  availableBalance: number;
  pendingPayoutAmount: number;
  minimumPayoutAmount: number;
  canRequestPayout: boolean;
}

export interface CreatePayoutOptions {
  processedBy?: string;
  notes?: string;
}

export interface TriggerPayoutOptions extends CreatePayoutOptions {
  amount?: number;
  bypassMinimum?: boolean;
}

export interface SettleManualPayoutOptions extends CreatePayoutOptions {
  /** Approve a specific pending manual payout; otherwise the oldest pending for the store. */
  payoutId?: string;
}

export interface RejectManualPayoutOptions extends CreatePayoutOptions {
  payoutId?: string;
}
