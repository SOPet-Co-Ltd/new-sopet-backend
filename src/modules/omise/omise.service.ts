import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OmiseRecipient {
  id: string;
  verified: boolean;
  active: boolean;
  failure_code?: string | null;
  bank_account?: {
    brand?: string;
    number?: string;
    name?: string;
    last_digits?: string;
  };
}

export interface OmiseTransfer {
  id: string;
  amount: number;
  currency: string;
  sent: boolean;
  paid: boolean;
  failure_code?: string | null;
  failure_message?: string | null;
}

interface CreateRecipientParams {
  name: string;
  email?: string;
  type?: 'individual' | 'corporation';
  taxId?: string;
  bankBrand: string;
  bankNumber: string;
  bankName: string;
}

/**
 * Thin wrapper around the Omise REST API for payout-side constructs
 * (recipients & transfers). Mirrors the request pattern used by
 * PaymentsService and reuses the shared `omise` config.
 */
@Injectable()
export class OmiseService {
  private readonly logger = new Logger(OmiseService.name);
  private readonly secretKey: string;

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('omise.secretKey') ?? '';
  }

  hasCredentials(): boolean {
    return this.secretKey.length > 0;
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`https://api.omise.co${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      this.logger.error(`Omise error (${path}): ${JSON.stringify(data)}`);
      throw new BadRequestException({
        code: 'OMISE_ERROR',
        message: (data as { message?: string }).message ?? 'Payment provider error',
      });
    }
    return data;
  }

  async createRecipient(params: CreateRecipientParams): Promise<OmiseRecipient> {
    return this.request<OmiseRecipient>('/recipients', 'POST', {
      name: params.name,
      email: params.email,
      type: params.type ?? 'individual',
      tax_id: params.taxId,
      bank_account: {
        brand: params.bankBrand,
        number: params.bankNumber,
        name: params.bankName,
      },
    });
  }

  async updateRecipient(
    recipientId: string,
    params: CreateRecipientParams,
  ): Promise<OmiseRecipient> {
    return this.request<OmiseRecipient>(`/recipients/${recipientId}`, 'PATCH', {
      name: params.name,
      email: params.email,
      type: params.type ?? 'individual',
      tax_id: params.taxId,
      bank_account: {
        brand: params.bankBrand,
        number: params.bankNumber,
        name: params.bankName,
      },
    });
  }

  async getRecipient(recipientId: string): Promise<OmiseRecipient> {
    return this.request<OmiseRecipient>(`/recipients/${recipientId}`);
  }

  async getTransfer(transferId: string): Promise<OmiseTransfer> {
    return this.request<OmiseTransfer>(`/transfers/${transferId}`);
  }

  async createTransfer(recipientId: string, amountSatang: number): Promise<OmiseTransfer> {
    return this.request<OmiseTransfer>('/transfers', 'POST', {
      recipient: recipientId,
      amount: amountSatang,
    });
  }
}
