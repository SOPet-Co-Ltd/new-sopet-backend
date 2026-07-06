import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly fromAddress: string;
  private readonly isDev: boolean;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('resend.apiKey');
    const from = this.configService.get<string>('resend.from') || 'noreply@sopet.co.th';
    const fromName = this.configService.get<string>('resend.fromName') || 'SOPet Marketplace';

    this.isDev =
      (this.configService.get<string>('app.environment') ??
        process.env.NODE_ENV ??
        'development') === 'development';
    this.fromAddress = `${fromName} <${from}>`;
    this.client = apiKey ? new Resend(apiKey) : null;

    if (!this.isDev && !this.client) {
      this.logger.warn('RESEND_API_KEY is not set — emails will be logged to console only');
    }
  }

  async send(options: SendEmailOptions): Promise<{ id: string | null }> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    if (this.isDev) {
      this.logDevEmail(recipients, options);
      return { id: null };
    }

    if (!this.client) {
      this.logger.log(`[dev] Email -> ${recipients.join(', ')} | ${options.subject}`);
      return { id: null };
    }

    const { data, error } = await this.client.emails.send({
      from: this.fromAddress,
      to: recipients,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (error) {
      this.logger.error(`Resend error: ${error.message}`, error.name);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return { id: data?.id ?? null };
  }

  private logDevEmail(recipients: string[], options: SendEmailOptions): void {
    const body = options.text ?? options.html;
    this.logger.log(
      '\n' +
        '========================================\n' +
        '[DEV EMAIL] not sent (development mode)\n' +
        `  To:      ${recipients.join(', ')}\n` +
        `  Subject: ${options.subject}\n` +
        `  Body:    ${body}\n` +
        '========================================',
    );
  }
}
