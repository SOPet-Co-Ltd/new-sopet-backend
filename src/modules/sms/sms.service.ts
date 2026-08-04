import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ThaiBulkSmsResponse {
  bad_phone_number_list?: Array<{ message: string; number: string }>;
  phone_number_list?: Array<unknown>;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly isDev: boolean;
  private readonly otpLogOnly: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isDev =
      (this.configService.get<string>('app.environment') ??
        process.env.NODE_ENV ??
        'development') === 'development';
    this.otpLogOnly = this.configService.get<boolean>('thaibulksms.otpLogOnly') ?? false;
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const message = `Your SOPet verification code is ${code}. Valid for 5 minutes.`;

    if (this.isDev || this.otpLogOnly) {
      this.logDevSms(phone, code, message);
      return;
    }

    const tbKey = this.configService.get<string>('thaibulksms.apiKey');
    const tbSecret = this.configService.get<string>('thaibulksms.apiSecret');
    const tbSender = this.configService.get<string>('thaibulksms.sender') || 'SOPet';
    const tbForce = this.configService.get<string>('thaibulksms.force') || 'corporate';
    const tbShortenUrl = this.configService.get<boolean>('thaibulksms.shortenUrl') ?? false;

    if (tbKey && tbSecret) {
      await this.sendThaiBulkSms(phone, message, tbKey, tbSecret, tbSender, tbForce, tbShortenUrl);
      return;
    }

    const accountSid = this.configService.get<string>('twilio.accountSid');
    const authToken = this.configService.get<string>('twilio.authToken');
    const fromNumber = this.configService.get<string>('twilio.phoneNumber');

    if (accountSid && authToken && fromNumber) {
      await this.sendTwilio(phone, message, accountSid, authToken, fromNumber);
      return;
    }

    this.logger.error('SMS delivery skipped: no ThaiBulkSMS or Twilio credentials configured');
    throw new ServiceUnavailableException({
      code: 'SMS_NOT_CONFIGURED',
      message: 'SMS delivery is not configured. Please contact support.',
    });
  }

  private logDevSms(phone: string, code: string, message: string): void {
    const mode = this.isDev ? 'development mode' : 'SMS_OTP_LOG_ONLY';
    this.logger.log(
      '\n' +
        '========================================\n' +
        `[DEV SMS] not sent (${mode})\n` +
        `  To:      ${phone}\n` +
        `  Code:    ${code}\n` +
        `  Message: ${message}\n` +
        '========================================',
    );
  }

  private async sendThaiBulkSms(
    phone: string,
    message: string,
    apiKey: string,
    apiSecret: string,
    sender: string,
    force: string,
    shortenUrl: boolean,
  ): Promise<void> {
    const msisdn = phone.replace(/^\+66/, '0').replace(/\D/g, '');
    const body = new URLSearchParams({
      msisdn,
      message,
      sender,
      force,
      shorten_url: shortenUrl ? 'true' : 'false',
    });

    const response = await fetch('https://api-v2.thaibulksms.com/sms', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const responseText = await response.text();
    let parsed: ThaiBulkSmsResponse | null = null;
    try {
      parsed = responseText ? (JSON.parse(responseText) as ThaiBulkSmsResponse) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      this.logger.error(`ThaiBulkSMS failed (${response.status}): ${responseText}`);
      throw new ServiceUnavailableException({
        code: 'SMS_DELIVERY_FAILED',
        message: 'Unable to send OTP SMS. Please try again later.',
      });
    }

    if (parsed?.bad_phone_number_list?.length && !parsed.phone_number_list?.length) {
      const providerMessage = parsed.bad_phone_number_list[0]?.message ?? 'Invalid phone number';
      this.logger.error(`ThaiBulkSMS rejected phone ${msisdn}: ${providerMessage}`);
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'Invalid phone number for SMS delivery.',
      });
    }
  }

  private async sendTwilio(
    phone: string,
    message: string,
    accountSid: string,
    authToken: string,
    fromNumber: string,
  ): Promise<void> {
    const digits = phone.replace(/\D/g, '');
    const to = phone.startsWith('+') ? phone : `+66${digits.replace(/^0/, '')}`;
    const body = new URLSearchParams({ To: to, From: fromNumber, Body: message });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Twilio SMS failed: ${errorText}`);
      throw new ServiceUnavailableException({
        code: 'SMS_DELIVERY_FAILED',
        message: 'Unable to send OTP SMS. Please try again later.',
      });
    }
  }
}
