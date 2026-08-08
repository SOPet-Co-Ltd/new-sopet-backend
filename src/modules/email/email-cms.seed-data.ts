import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';

/**
 * Pure string-constant seed source for the Email CMS migration (Design Doc §
 * Seed Migration Approach). Deliberately framework-free (no NestJS/TypeORM
 * imports) so the migration can import it directly. Mirrors the structure
 * and Thai copy of `email-templates.ts` `layout()` + the eight template
 * functions — structural parity is required (AC-003), pixel-identical CSS is
 * not.
 */

const BRAND_PRIMARY = '#9C6ADE';
const BRAND_PRIMARY_DARK = '#884ECF';
const BRAND_PRIMARY_LIGHT = '#F2EBFC';
const BRAND_PRIMARY_SOFT = '#F9F6FE';
const TEXT_PRIMARY = '#1A1A1A';
const TEXT_SECONDARY = '#5C5C5C';
const TEXT_MUTED = '#888888';
const BORDER = '#E7DBF9';

function heroBadge(label: string, tone: 'primary' | 'success' | 'info' = 'primary'): string {
  const tones = {
    primary: { bg: BRAND_PRIMARY_LIGHT, color: BRAND_PRIMARY_DARK, border: BORDER },
    success: { bg: '#EAF8EE', color: '#1F7A39', border: '#ABE2B8' },
    info: { bg: '#F2F7F9', color: '#5587A0', border: '#C2D7DF' },
  };
  const palette = tones[tone];
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
    <tr><td style="background:${palette.bg};border:1px solid ${palette.border};color:${palette.color};font-size:12px;font-weight:600;padding:8px 14px;border-radius:999px;">
      ${label}
    </td></tr>
  </table>`;
}

function sectionTitle(title: string, subtitle?: string): string {
  return `<h1 style="margin:0 0 8px;font-size:24px;line-height:1.3;color:${TEXT_PRIMARY};">${title}</h1>
    ${subtitle ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:${TEXT_SECONDARY};">${subtitle}</p>` : ''}`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
        <td style="padding:10px 0;font-size:13px;color:${TEXT_MUTED};width:42%;vertical-align:top;">${label}</td>
        <td style="padding:10px 0;font-size:14px;color:${TEXT_PRIMARY};font-weight:600;text-align:right;vertical-align:top;">${value}</td>
      </tr>`;
}

function infoPanel(rowsHtml: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:${BRAND_PRIMARY_SOFT};border:1px solid ${BORDER};border-radius:14px;">
    <tr><td style="padding:18px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
    </td></tr>
  </table>`;
}

function highlightBox(content: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="padding:18px 20px;background:${BRAND_PRIMARY_LIGHT};border-left:4px solid ${BRAND_PRIMARY};border-radius:12px;">
      <p style="margin:0;font-size:14px;line-height:1.7;color:${TEXT_SECONDARY};">${content}</p>
    </td></tr>
  </table>`;
}

function cta(href: string, label: string, noteBelow?: string): string {
  const noteHtml = noteBelow
    ? `<tr><td align="center" style="padding-top:12px;"><p style="margin:0;font-size:13px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">${noteBelow}</p></td></tr>`
    : '';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="border-radius:999px;background:linear-gradient(135deg,${BRAND_PRIMARY} 0%,${BRAND_PRIMARY_DARK} 100%);box-shadow:0 8px 20px rgba(156,106,222,0.28);">
              <a href="${href}" style="display:block;width:100%;box-sizing:border-box;padding:14px 32px;border-radius:999px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;text-align:center;">${label}</a>
            </td>
          </tr>
          ${noteHtml}
        </table>
      </td>
    </tr>
  </table>`;
}

function note(text: string): string {
  return `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">${text}</p>`;
}

export const DEFAULT_CONTAINER_SEED = {
  name: 'Sopet Default',
  isDefault: true,
  htmlShell: `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sopet</title>
</head>
<body style="margin:0;padding:0;background:${BRAND_PRIMARY_SOFT};font-family:'Noto Sans Thai',Arial,sans-serif;color:${TEXT_PRIMARY};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_PRIMARY_SOFT};padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 12px 40px rgba(156,106,222,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND_PRIMARY} 0%,${BRAND_PRIMARY_DARK} 100%);padding:28px 32px 24px;text-align:center;">
            <img src="{{logoUrl}}" alt="Sopet" width="132" style="display:block;margin:0 auto 10px;border:0;max-width:132px;height:auto;" />
            <div style="font-size:13px;color:rgba(255,255,255,0.88);letter-spacing:0.04em;">Sopet (โซเพ็ท) ยาสัตว์ออนไลน์</div>
          </td>
        </tr>
        <tr><td style="padding:32px 32px 8px;">{{{content}}}</td></tr>
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid ${BORDER};background:${BRAND_PRIMARY_SOFT};">
            <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">
              อีเมลล์นี้ส่งจาก Sopet กรุณาอย่าตอบกลับอีเมลนี้
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">
              หากต้องการความช่วยเหลือ ติดต่อทีมงาน Sopet ผ่านเว็บไซต์ของเรา
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
};

export interface EmailContentTemplateSeed {
  key: EmailTemplateKey;
  name: string;
  subjectTemplate: string;
  bodyHtml: string;
  textTemplate: string;
  enabled: boolean;
}

export const CONTENT_TEMPLATE_SEEDS: EmailContentTemplateSeed[] = [
  {
    key: EmailTemplateKey.VENDOR_INVITE,
    name: 'คำเชิญผู้ขาย',
    subjectTemplate: 'คำเชิญเข้าร่วม Sopet ในฐานะผู้ขาย',
    textTemplate:
      'คุณได้รับเชิญให้เข้าร่วม Sopet ในฐานะผู้ขาย กรุณาเปิดลิงก์นี้เพื่อสมัคร: {{inviteUrl}}',
    bodyHtml: `${heroBadge('คำเชิญพิเศษ')}
    ${sectionTitle('ยินดีต้อนรับสู่ทีมผู้ขาย Sopet', 'เริ่มต้นขายสินค้าสำหรับสัตว์เลี้ยงบนแพลตฟอร์มที่ลูกค้าไว้วางใจ')}
    ${highlightBox('คุณได้รับเชิญให้เปิดร้านค้าบน Sopet กรุณาตั้งรหัสผ่านและเริ่มจัดการสินค้า คำสั่งซื้อ และโปรโมชันของร้านคุณได้ทันที')}
    ${infoPanel(infoRow('บทบาท', 'ผู้ขาย (Vendor)') + infoRow('สิทธิ์การใช้งาน', 'จัดการร้านค้าและสินค้า') + infoRow('อายุลิงก์', '7 วัน'))}
    ${cta('{{inviteUrl}}', 'ยอมรับคำเชิญและเริ่มต้น', 'ลิงก์นี้จะหมดอายุภายใน 7 วัน')}
    ${note('หากคุณไม่ได้คาดหวังอีเมลนี้ สามารถเพิกเฉยได้อย่างปลอดภัย')}`,
    enabled: true,
  },
  {
    key: EmailTemplateKey.ADMIN_INVITE,
    name: 'คำเชิญผู้ดูแลระบบ',
    subjectTemplate: 'คำเชิญเข้าร่วมทีมผู้ดูแลระบบ Sopet',
    textTemplate: 'คุณได้รับเชิญให้เป็นผู้ดูแลระบบ Sopet กรุณาเปิดลิงก์นี้: {{inviteUrl}}',
    bodyHtml: `${heroBadge('ทีมผู้ดูแลระบบ')}
    ${sectionTitle('คำเชิญเป็นผู้ดูแลระบบ', 'เข้าร่วมทีมงานเพื่อดูแลแพลตฟอร์ม Sopet')}
    ${highlightBox('คุณได้รับสิทธิ์เข้าถึงระบบผู้ดูแลแพลตฟอร์ม กรุณาตั้งรหัสผ่านก่อนเข้าใช้งานครั้งแรก')}
    ${infoPanel(infoRow('บทบาท', 'ผู้ดูแลระบบ (Admin)') + infoRow('การเข้าถึง', 'แผงควบคุมแพลตฟอร์ม') + infoRow('อายุลิงก์', '7 วัน'))}
    ${cta('{{inviteUrl}}', 'ยอมรับคำเชิญ', 'ลิงก์นี้จะหมดอายุภายใน 7 วัน')}`,
    enabled: true,
  },
  {
    key: EmailTemplateKey.STORE_MEMBER_INVITE,
    name: 'คำเชิญทีมร้านค้า',
    subjectTemplate: 'คำเชิญเข้าร่วมทีมร้าน {{storeName}}',
    textTemplate: 'คุณได้รับเชิญให้เข้าร่วมทีมร้าน {{storeName}} บน Sopet: {{inviteUrl}}',
    bodyHtml: `${heroBadge('ทีมร้านค้า')}
    ${sectionTitle('เข้าร่วมทีมร้านของคุณ', 'คุณได้รับเชิญให้ช่วยดูแลร้าน {{storeName}} บน Sopet')}
    ${highlightBox('หลังจากยอมรับคำเชิญ คุณจะสามารถเข้าถึงแดชบอร์ดร้านค้า จัดการออเดอร์ และทำงานร่วมกับทีมได้ทันที')}
    ${infoPanel(infoRow('ร้านค้า', '{{storeName}}') + infoRow('สิทธิ์', 'สมาชิกทีมร้าน') + infoRow('อายุลิงก์', '7 วัน'))}
    ${cta('{{inviteUrl}}', 'ยอมรับคำเชิญ', 'ลิงก์นี้จะหมดอายุภายใน 7 วัน')}`,
    enabled: true,
  },
  {
    key: EmailTemplateKey.PASSWORD_RESET,
    name: 'รีเซ็ตรหัสผ่าน',
    subjectTemplate: 'รีเซ็ตรหัสผ่าน Sopet',
    textTemplate: 'กรุณาเปิดลิงก์นี้เพื่อรีเซ็ตรหัสผ่านของคุณ: {{resetUrl}}',
    bodyHtml: `${heroBadge('ความปลอดภัยบัญชี', 'info')}
    ${sectionTitle('รีเซ็ตรหัสผ่าน', 'เราได้รับคำขอให้รีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ')}
    ${highlightBox('หากคุณเป็นผู้ร้องขอ กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ หากไม่ใช่ กรุณาเพิกเฉยอีเมลนี้')}
    ${infoPanel(infoRow('การดำเนินการ', 'ตั้งรหัสผ่านใหม่') + infoRow('อายุลิงก์', '1 ชั่วโมง') + infoRow('คำแนะนำ', 'ใช้ลิงก์เพียงครั้งเดียว'))}
    ${cta('{{resetUrl}}', 'ตั้งรหัสผ่านใหม่', 'ลิงก์นี้จะหมดอายุภายใน 1 ชั่วโมง')}`,
    enabled: true,
  },
  {
    key: EmailTemplateKey.EMAIL_VERIFICATION,
    name: 'ยืนยันอีเมล',
    subjectTemplate: 'ยืนยันอีเมล Sopet',
    textTemplate: 'กรุณาเปิดลิงก์นี้เพื่อยืนยันอีเมลของคุณ: {{verifyUrl}}',
    bodyHtml: `${heroBadge('ยืนยันอีเมล', 'info')}
    ${sectionTitle('ยืนยันอีเมลของคุณ', 'กรุณายืนยันอีเมลเพื่อใช้งานบัญชีผู้ขายบน Sopet')}
    ${highlightBox('หากคุณเป็นผู้ร้องขอ กรุณากดปุ่มด้านล่างเพื่อยืนยันอีเมล หากไม่ใช่ กรุณาเพิกเฉยอีเมลนี้')}
    ${infoPanel(infoRow('การดำเนินการ', 'ยืนยันอีเมล') + infoRow('อายุลิงก์', '24 ชั่วโมง') + infoRow('คำแนะนำ', 'ใช้ลิงก์เพียงครั้งเดียว'))}
    ${cta('{{verifyUrl}}', 'ยืนยันอีเมล', 'ลิงก์นี้จะหมดอายุภายใน 24 ชั่วโมง')}`,
    enabled: true,
  },
  {
    key: EmailTemplateKey.ORDER_PAID,
    name: 'ชำระเงินสำเร็จ',
    subjectTemplate: 'ชำระเงินสำเร็จ — คำสั่งซื้อ {{orderNumber}}',
    textTemplate:
      'ขอบคุณที่ชำระเงินสำหรับคำสั่งซื้อ {{orderNumber}} ยอดรวม {{total}} ดูรายละเอียด: {{orderUrl}}',
    bodyHtml: `${heroBadge('ชำระเงินสำเร็จ', 'success')}
    ${sectionTitle('ขอบคุณสำหรับคำสั่งซื้อ', 'เราได้รับการชำระเงินของคุณเรียบร้อยแล้ว และกำลังเตรียมคำสั่งซื้อให้คุณ')}
    ${infoPanel(
      infoRow('หมายเลขคำสั่งซื้อ', '{{orderNumber}}') +
        infoRow('วันที่สั่งซื้อ', '{{orderDate}}') +
        infoRow('ช่องทางชำระเงิน', '{{paymentMethod}}') +
        infoRow('ผู้สั่งซื้อ', '{{customerName}}'),
    )}
    <h2 style="margin:0 0 12px;font-size:16px;color:${BRAND_PRIMARY_DARK};">รายการสินค้า</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
      <tr style="background:${BRAND_PRIMARY_LIGHT};">
        <th align="left" style="padding:12px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">สินค้า</th>
        <th style="padding:12px 8px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">จำนวน</th>
        <th align="right" style="padding:12px 8px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">ราคา</th>
        <th align="right" style="padding:12px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">รวม</th>
      </tr>
      {{itemsHtml}}
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;">
      <tr><td style="padding:18px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:8px 0;font-size:13px;color:${TEXT_MUTED};">ยอดสินค้า</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:${TEXT_PRIMARY};">{{subtotal}}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:${TEXT_MUTED};">ส่วนลด</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:${TEXT_PRIMARY};">-{{discountAmount}}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:${TEXT_MUTED};">ค่าจัดส่ง</td><td style="padding:8px 0;text-align:right;font-size:14px;font-weight:600;color:${TEXT_PRIMARY};">{{shippingFee}}</td></tr>
          <tr><td style="padding:8px 0;font-size:15px;font-weight:700;color:${TEXT_PRIMARY};">ยอดชำระทั้งหมด</td><td style="padding:8px 0;text-align:right;font-size:20px;font-weight:700;color:${BRAND_PRIMARY_DARK};">{{total}}</td></tr>
        </table>
      </td></tr>
    </table>
    ${cta('{{orderUrl}}', 'ดูรายละเอียดคำสั่งซื้อ')}
    ${note('สามารถดูอัพเดตสินค้า ผ่านไลน์ @sopet')}`,
    enabled: true,
  },
  {
    key: EmailTemplateKey.ORDER_STATUS_CHANGED,
    name: 'อัปเดตสถานะคำสั่งซื้อ',
    subjectTemplate: 'คำสั่งซื้อ {{orderNumber}} — {{statusLabel}}',
    textTemplate:
      'คำสั่งซื้อ {{orderNumber}} อัปเดตสถานะเป็น {{statusLabel}} ติดตามคำสั่งซื้อ: {{orderUrl}}',
    bodyHtml: `${heroBadge('สถานะ: {{statusLabel}}', 'info')}
    ${sectionTitle('อัปเดตคำสั่งซื้อของคุณ', 'มีการเปลี่ยนแปลงสถานะคำสั่งซื้อล่าสุด')}
    ${highlightBox('คำสั่งซื้อ <strong>{{orderNumber}}</strong> ของคุณตอนนี้อยู่ในสถานะ <strong>{{statusLabel}}</strong>')}
    ${infoPanel(infoRow('หมายเลขคำสั่งซื้อ', '{{orderNumber}}') + infoRow('สถานะปัจจุบัน', '{{statusLabel}}') + infoRow('วันที่สั่งซื้อ', '{{orderDate}}'))}
    ${cta('{{orderUrl}}', 'ติดตามคำสั่งซื้อ')}
    ${note('คุณสามารถตรวจสอบรายละเอียดและประวัติการจัดส่งได้จากลิงก์ด้านบน')}`,
    enabled: true,
  },
  {
    key: EmailTemplateKey.VENDOR_ACCOUNT_SUSPENDED,
    name: 'บัญชีผู้ขายถูกระงับ',
    subjectTemplate: 'บัญชีผู้ขาย Sopet ของคุณถูกระงับ',
    textTemplate:
      'เรียนคุณ{{vendorName}} บัญชีผู้ขายของคุณบน Sopet ({{storeName}}) ถูกระงับชั่วคราว คุณจะไม่สามารถเข้าสู่ระบบได้ กรุณาติดต่อฝ่ายสนับสนุนหากต้องการความช่วยเหลือ',
    bodyHtml: `${heroBadge('บัญชีถูกระงับ', 'info')}
    ${sectionTitle('บัญชีผู้ขายของคุณถูกระงับ', 'คุณจะไม่สามารถเข้าสู่ระบบแผงผู้ขายได้จนกว่าบัญชีจะได้รับการเปิดใช้งานอีกครั้ง')}
    ${highlightBox('ผู้ดูแลระบบได้ระงับบัญชีผู้ขายของคุณบน Sopet ชั่วคราว หากคุณเชื่อว่านี่เป็นความผิดพลาด หรือต้องการขอเปิดใช้งานอีกครั้ง กรุณาติดต่อฝ่ายสนับสนุน')}
    ${infoPanel(infoRow('บัญชี', '{{vendorName}}') + infoRow('ร้านค้า', '{{storeName}}') + infoRow('สถานะ', 'ระงับชั่วคราว'))}
    ${note('หากต้องการความช่วยเหลือ กรุณาติดต่อทีมงาน Sopet ผ่านช่องทางสนับสนุนบนเว็บไซต์')}`,
    enabled: true,
  },
];
