import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import {
  adminInviteTemplate,
  EmailTemplateBrand,
  orderPaidTemplate,
  orderStatusChangedTemplate,
  passwordResetTemplate,
  storeMemberInviteTemplate,
  vendorInviteTemplate,
} from './email-templates';

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private readonly adminPanelUrl: string;
  private readonly storefrontUrl: string;
  private readonly brand: EmailTemplateBrand;

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.adminPanelUrl =
      this.configService.get<string>('app.adminPanelUrl') ||
      process.env.ADMIN_PANEL_URL ||
      'http://localhost:3001';
    this.storefrontUrl =
      this.configService.get<string>('app.storefrontUrl') ||
      process.env.STOREFRONT_URL ||
      'http://localhost:3000';
    this.brand = {
      logoUrl: `${this.storefrontUrl}/images/email/sopet-logo-white.svg`,
    };
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
    await this.sendTemplate(
      email,
      vendorInviteTemplate(this.brand, { inviteUrl }),
      'Vendor invite',
      inviteUrl,
    );
  }

  async sendAdminInvite(email: string, token: string): Promise<void> {
    const inviteUrl = `${this.adminPanelUrl}/register?adminToken=${token}`;
    await this.sendTemplate(
      email,
      adminInviteTemplate(this.brand, { inviteUrl }),
      'Admin invite',
      inviteUrl,
    );
  }

  async sendStoreMemberInvite(
    email: string,
    token: string,
    storeId: string,
    storeName: string,
  ): Promise<void> {
    const inviteUrl = `${this.adminPanelUrl}/invite/store?token=${token}`;
    await this.sendTemplate(
      email,
      storeMemberInviteTemplate(this.brand, { inviteUrl, storeName }),
      'Store member invite',
      inviteUrl,
    );
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = `${this.adminPanelUrl}/reset-password?token=${token}`;
    await this.sendTemplate(
      email,
      passwordResetTemplate(this.brand, { resetUrl }),
      'Password reset',
      resetUrl,
    );
  }

  async sendOrderPaid(
    email: string,
    params: {
      orderNumber: string;
      orderDate: string;
      paymentMethod: string;
      customerName?: string;
      items: Array<{
        productName: string;
        variantOptions?: Record<string, string>;
        quantity: number;
        unitPrice: number;
        subtotal: number;
      }>;
      subtotal: number;
      discountAmount: number;
      shippingFee: number;
      total: number;
      orderUrl: string;
    },
  ): Promise<void> {
    await this.sendTemplate(
      email,
      orderPaidTemplate(this.brand, params),
      'Order paid',
      params.orderUrl,
    );
  }

  async sendOrderStatusChanged(
    email: string,
    params: { orderNumber: string; status: string; orderDate?: string; orderUrl: string },
  ): Promise<void> {
    await this.sendTemplate(
      email,
      orderStatusChangedTemplate(this.brand, params),
      'Order status changed',
      params.orderUrl,
    );
  }
}
