import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export type BeamPaymentMethodType = 'QR_PROMPT_PAY' | 'CARD_TOKEN' | 'TRUE_MONEY' | 'SHOPEE_PAY';

export type BeamActionRequired = 'NONE' | 'REDIRECT' | 'ENCODED_IMAGE';

export type BeamChargeStatus = string;

export interface BeamCreateChargeBody {
  amount: number;
  currency: string;
  referenceId: string;
  returnUrl: string;
  skip3dsFlow?: boolean;
  paymentMethod: {
    paymentMethodType: BeamPaymentMethodType;
    cardToken?: {
      cardTokenId: string;
      securityCode: string;
    };
    qrPromptPay?: {
      expiryTime: string;
    };
    trueMoney?: Record<string, never>;
    shopeePay?: Record<string, never>;
  };
}

export interface BeamCharge {
  chargeId: string;
  status?: BeamChargeStatus;
  amount?: number;
  currency?: string;
  referenceId?: string;
  actionRequired?: BeamActionRequired;
  redirect?: { redirectUrl?: string };
  encodedImage?: { imageBase64Encoded?: string };
}

@Injectable()
export class BeamService {
  private readonly logger = new Logger(BeamService.name);
  private readonly apiBaseUrl: string;
  private readonly merchantId: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.apiBaseUrl =
      this.configService.get<string>('beam.apiBaseUrl') ?? 'https://api.beamcheckout.com';
    this.merchantId = this.configService.get<string>('beam.merchantId') ?? '';
    this.apiKey = this.configService.get<string>('beam.apiKey') ?? '';
    this.webhookSecret = this.configService.get<string>('beam.webhookSecret') ?? '';
  }

  hasCredentials(): boolean {
    return this.merchantId.length > 0 && this.apiKey.length > 0;
  }

  private basicAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.merchantId}:${this.apiKey}`).toString('base64')}`;
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.basicAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await response.json()) as T & { message?: string; error?: string };
    if (!response.ok) {
      this.logger.error(`Beam error (${path}): ${JSON.stringify(data)}`);
      throw new BadRequestException({
        code: 'BEAM_ERROR',
        message: data.message ?? data.error ?? 'Payment provider error',
      });
    }
    return data;
  }

  async createCharge(body: BeamCreateChargeBody): Promise<BeamCharge> {
    return this.request<BeamCharge>(
      '/api/v1/charges',
      'POST',
      body as unknown as Record<string, unknown>,
    );
  }

  async getCharge(chargeId: string): Promise<BeamCharge> {
    return this.request<BeamCharge>(`/api/v1/charges/${encodeURIComponent(chargeId)}`, 'GET');
  }

  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !this.webhookSecret) {
      return false;
    }

    try {
      const secret = Buffer.from(this.webhookSecret, 'base64');
      const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
      const expected = createHmac('sha256', secret).update(body).digest('base64');
      const expectedBuf = Buffer.from(expected);
      const actualBuf = Buffer.from(signatureHeader.trim());
      if (expectedBuf.length !== actualBuf.length) {
        return false;
      }
      return timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }
}
