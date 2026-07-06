import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly isDev: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isDev =
      (this.configService.get<string>('app.environment') ??
        process.env.NODE_ENV ??
        'development') === 'development';
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const message = `Your SOPet verification code is ${code}. Valid for 5 minutes.`;

    if (this.isDev) {
      this.logDevSms(phone, code, message);
      return;
    }

    const tbKey = this.configService.get<string>('thaibulksms.apiKey');
    const tbSecret = this.configService.get<string>('thaibulksms.apiSecret');
    const tbSender = this.configService.get<string>('thaibulksms.sender') || 'SOPet';

    if (tbKey && tbSecret) {
      await this.sendThaiBulkSms(phone, message, tbKey, tbSecret, tbSender);
      return;
    }

    const accountSid = this.configService.get<string>('twilio.accountSid');
    const authToken = this.configService.get<string>('twilio.authToken');
    const fromNumber = this.configService.get<string>('twilio.phoneNumber');

    if (accountSid && authToken && fromNumber) {
      await this.sendTwilio(phone, message, accountSid, authToken, fromNumber);
      return;
    }

    this.logger.log(`[dev] OTP for ${phone}: ${code}`);
  }

  private logDevSms(phone: string, code: string, message: string): void {
    this.logger.log(
      '\n' +
        '========================================\n' +
        '[DEV SMS] not sent (development mode)\n' +
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
  ): Promise<void> {
    const msisdn = phone.replace(/^\+66/, '0').replace(/\D/g, '');
    const response = await fetch('https://api-v2.thaibulksms.com/sms', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ msisdn, message, sender }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`ThaiBulkSMS failed: ${errorText}`);
      throw new Error('Failed to send OTP SMS');
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
      throw new Error('Failed to send OTP SMS');
    }
  }
}
