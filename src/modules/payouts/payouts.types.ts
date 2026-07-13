export interface PayoutSummary {
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
