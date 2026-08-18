import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailTemplateRendererService } from './email-template-renderer.service';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';
import {
  formatCurrency,
  formatOrderStatus,
  formatPaymentMethod,
  orderItemsRows,
} from './email-templates';

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);
  private readonly adminPanelUrl: string;

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly renderer: EmailTemplateRendererService,
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
    const result = await this.renderer.renderForSend(EmailTemplateKey.VENDOR_INVITE, {
      vars: { inviteUrl },
      fallbackParams: { inviteUrl },
    });
    await this.sendTemplate(email, result, 'Vendor invite', inviteUrl);
  }

  async sendAdminInvite(email: string, token: string): Promise<void> {
    const inviteUrl = `${this.adminPanelUrl}/register/invite/admin?token=${token}`;
    const result = await this.renderer.renderForSend(EmailTemplateKey.ADMIN_INVITE, {
      vars: { inviteUrl },
      fallbackParams: { inviteUrl },
    });
    await this.sendTemplate(email, result, 'Admin invite', inviteUrl);
  }

  async sendStoreMemberInvite(
    email: string,
    token: string,
    storeId: string,
    storeName: string,
  ): Promise<void> {
    const inviteUrl = `${this.adminPanelUrl}/invite/store?token=${token}`;
    const result = await this.renderer.renderForSend(EmailTemplateKey.STORE_MEMBER_INVITE, {
      vars: { inviteUrl, storeName },
      fallbackParams: { inviteUrl, storeName },
    });
    await this.sendTemplate(email, result, 'Store member invite', inviteUrl);
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = `${this.adminPanelUrl}/reset-password?token=${token}`;
    const result = await this.renderer.renderForSend(EmailTemplateKey.PASSWORD_RESET, {
      vars: { resetUrl },
      fallbackParams: { resetUrl },
    });
    await this.sendTemplate(email, result, 'Password reset', resetUrl);
  }

  async sendEmailVerification(email: string, token: string): Promise<void> {
    const verifyUrl = `${this.adminPanelUrl}/verify-email?token=${token}`;
    const result = await this.renderer.renderForSend(EmailTemplateKey.EMAIL_VERIFICATION, {
      vars: { verifyUrl },
      fallbackParams: { verifyUrl },
    });
    await this.sendTemplate(email, result, 'Email verification', verifyUrl);
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
    const vars: Record<string, string> = {
      orderNumber: params.orderNumber,
      orderDate: params.orderDate,
      paymentMethod: formatPaymentMethod(params.paymentMethod),
      subtotal: `฿${formatCurrency(params.subtotal)}`,
      discountAmount: `฿${formatCurrency(params.discountAmount)}`,
      shippingFee: `฿${formatCurrency(params.shippingFee)}`,
      total: `฿${formatCurrency(params.total)}`,
      orderUrl: params.orderUrl,
      // Rows only — CMS ORDER_PAID body already wraps headers + <table>.
      itemsHtml: orderItemsRows(params.items),
    };
    if (params.customerName) {
      vars.customerName = params.customerName;
    }

    const result = await this.renderer.renderForSend(EmailTemplateKey.ORDER_PAID, {
      vars,
      fallbackParams: params,
    });
    await this.sendTemplate(email, result, 'Order paid', params.orderUrl);
  }

  async sendOrderStatusChanged(
    email: string,
    params: { orderNumber: string; status: string; orderDate?: string; orderUrl: string },
  ): Promise<void> {
    const vars: Record<string, string> = {
      orderNumber: params.orderNumber,
      status: params.status,
      statusLabel: formatOrderStatus(params.status),
      orderUrl: params.orderUrl,
    };
    if (params.orderDate) {
      vars.orderDate = params.orderDate;
    }

    const result = await this.renderer.renderForSend(EmailTemplateKey.ORDER_STATUS_CHANGED, {
      vars,
      fallbackParams: params,
    });
    await this.sendTemplate(email, result, 'Order status changed', params.orderUrl);
  }

  async sendVendorAccountSuspended(
    email: string,
    params: { vendorName?: string | null; storeName?: string | null } = {},
  ): Promise<void> {
    const vars: Record<string, string> = {
      vendorName: params.vendorName?.trim() || 'ผู้ขาย',
    };
    if (params.storeName?.trim()) {
      vars.storeName = params.storeName.trim();
    }

    const result = await this.renderer.renderForSend(EmailTemplateKey.VENDOR_ACCOUNT_SUSPENDED, {
      vars,
      fallbackParams: params,
    });
    await this.sendTemplate(email, result, 'Vendor account suspended');
  }
}
