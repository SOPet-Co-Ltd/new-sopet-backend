import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import {
  adminInviteTemplate,
  passwordResetTemplate,
  storeMemberInviteTemplate,
  vendorInviteTemplate,
} from './email-templates';

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private readonly adminPanelUrl: string;

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.adminPanelUrl =
      this.configService.get<string>('app.adminPanelUrl') ||
      process.env.ADMIN_PANEL_URL ||
      'http://localhost:3001';
  }

  private async sendTemplate(
    to: string,
    template: { subject: string; html: string; text: string },
    devLabel: string,
    devUrl?: string,
  ): Promise<void> {
    if (devUrl) {
      this.logger.log(`[dev] ${devLabel} -> ${to} | ${devUrl}`);
    }
    await this.emailService.send({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  }

  async sendVendorInvite(email: string, token: string): Promise<void> {
    const inviteUrl = `${this.adminPanelUrl}/register?token=${token}`;
    await this.sendTemplate(email, vendorInviteTemplate({ inviteUrl }), 'Vendor invite', inviteUrl);
  }

  async sendAdminInvite(email: string, token: string): Promise<void> {
    const inviteUrl = `${this.adminPanelUrl}/register?adminToken=${token}`;
    await this.sendTemplate(email, adminInviteTemplate({ inviteUrl }), 'Admin invite', inviteUrl);
  }

  async sendStoreMemberInvite(
    email: string,
    token: string,
    storeId: string,
    storeName: string,
  ): Promise<void> {
    const inviteUrl = `${this.adminPanelUrl}/register?storeToken=${token}&storeId=${storeId}`;
    await this.sendTemplate(
      email,
      storeMemberInviteTemplate({ inviteUrl, storeName }),
      'Store member invite',
      inviteUrl,
    );
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = `${this.adminPanelUrl}/reset-password?token=${token}`;
    await this.sendTemplate(email, passwordResetTemplate({ resetUrl }), 'Password reset', resetUrl);
  }
}
