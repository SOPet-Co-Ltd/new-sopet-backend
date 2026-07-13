const BRAND_PRIMARY = '#9C6ADE';
const BRAND_PRIMARY_DARK = '#884ECF';
const BRAND_PRIMARY_LIGHT = '#F2EBFC';
const BRAND_PRIMARY_SOFT = '#F9F6FE';
const BRAND_SECONDARY = '#FF6F61';
const BRAND_TERTIARY = '#5587A0';
const TEXT_PRIMARY = '#1A1A1A';
const TEXT_SECONDARY = '#5C5C5C';
const TEXT_MUTED = '#888888';
const BORDER = '#E7DBF9';
const SUCCESS = '#31B953';
const SUCCESS_BG = '#EAF8EE';

export interface EmailTemplateBrand {
  logoUrl: string;
}

export interface EmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

export interface OrderPaidLineItem {
  productName: string;
  variantOptions?: Record<string, string>;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(amount: number): string {
  return Number(amount).toLocaleString('th-TH');
}

function formatOrderStatus(status: string): string {
  const labels: Record<string, string> = {
    pending_payment: 'รอชำระเงิน',
    paid: 'ชำระเงินแล้ว',
    processing: 'กำลังเตรียมสินค้า',
    shipped: 'จัดส่งแล้ว',
    delivered: 'จัดส่งสำเร็จ',
    cancelled: 'ยกเลิกแล้ว',
    refunded: 'คืนเงินแล้ว',
  };

  return labels[status] ?? status.replace(/_/g, ' ');
}

function formatPaymentMethod(method: string): string {
  const labels: Record<string, string> = {
    promptpay: 'พร้อมเพย์',
    credit_card: 'บัตรเครดิต/เดบิต',
    cod: 'เก็บเงินปลายทาง',
  };

  return labels[method] ?? method;
}

function formatVariantOptions(options?: Record<string, string>): string {
  if (!options || Object.keys(options).length === 0) {
    return '';
  }

  return Object.entries(options)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ');
}

function layout(brand: EmailTemplateBrand, content: string, preheader?: string): string {
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SOPet</title>
</head>
<body style="margin:0;padding:0;background:${BRAND_PRIMARY_SOFT};font-family:'Noto Sans Thai',Arial,sans-serif;color:${TEXT_PRIMARY};">
  ${hiddenPreheader}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_PRIMARY_SOFT};padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 12px 40px rgba(156,106,222,0.12);">
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND_PRIMARY} 0%,${BRAND_PRIMARY_DARK} 100%);padding:28px 32px 24px;text-align:center;">
            <img src="${brand.logoUrl}" alt="SOPet" width="132" style="display:block;margin:0 auto 10px;border:0;max-width:132px;height:auto;" />
            <div style="font-size:13px;color:rgba(255,255,255,0.88);letter-spacing:0.04em;">Marketplace สำหรับคนรักสัตว์เลี้ยง</div>
          </td>
        </tr>
        <tr><td style="padding:32px 32px 8px;">${content}</td></tr>
        <tr>
          <td style="padding:20px 32px 28px;border-top:1px solid ${BORDER};background:${BRAND_PRIMARY_SOFT};">
            <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">
              อีเมลนี้ส่งจาก SOPet Marketplace · กรุณาอย่าตอบกลับอีเมลนี้
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">
              หากต้องการความช่วยเหลือ ติดต่อทีมงาน SOPet ผ่านเว็บไซต์ของเรา
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function heroBadge(label: string, tone: 'primary' | 'success' | 'info' = 'primary'): string {
  const tones = {
    primary: { bg: BRAND_PRIMARY_LIGHT, color: BRAND_PRIMARY_DARK, border: BORDER },
    success: { bg: SUCCESS_BG, color: '#1F7A39', border: '#ABE2B8' },
    info: { bg: '#F2F7F9', color: BRAND_TERTIARY, border: '#C2D7DF' },
  };
  const palette = tones[tone];

  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
    <tr><td style="background:${palette.bg};border:1px solid ${palette.border};color:${palette.color};font-size:12px;font-weight:600;padding:8px 14px;border-radius:999px;">
      ${escapeHtml(label)}
    </td></tr>
  </table>`;
}

function sectionTitle(title: string, subtitle?: string): string {
  return `<h1 style="margin:0 0 8px;font-size:24px;line-height:1.3;color:${TEXT_PRIMARY};">${escapeHtml(title)}</h1>
    ${
      subtitle
        ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:${TEXT_SECONDARY};">${escapeHtml(subtitle)}</p>`
        : ''
    }`;
}

function infoPanel(rows: Array<{ label: string; value: string }>): string {
  const cells = rows
    .map(
      (row) => `<tr>
        <td style="padding:10px 0;font-size:13px;color:${TEXT_MUTED};width:42%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:10px 0;font-size:14px;color:${TEXT_PRIMARY};font-weight:600;text-align:right;vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:${BRAND_PRIMARY_SOFT};border:1px solid ${BORDER};border-radius:14px;">
    <tr><td style="padding:18px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">${cells}</table>
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
    ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">${escapeHtml(noteBelow)}</p>`
    : '';

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="border-radius:999px;background:linear-gradient(135deg,${BRAND_PRIMARY} 0%,${BRAND_PRIMARY_DARK} 100%);box-shadow:0 8px 20px rgba(156,106,222,0.28);">
              <a href="${href}" style="display:block;width:100%;box-sizing:border-box;padding:14px 32px;border-radius:999px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;text-align:center;">${escapeHtml(label)}</a>
            </td>
          </tr>
          ${
            noteBelow
              ? `<tr><td align="center" style="padding-top:12px;">${noteHtml}</td></tr>`
              : ''
          }
        </table>
      </td>
    </tr>
  </table>`;
}

function note(text: string): string {
  return `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${TEXT_MUTED};text-align:center;">${escapeHtml(text)}</p>`;
}

function orderItemsTable(items: OrderPaidLineItem[]): string {
  const rows = items
    .map((item, index) => {
      const variant = formatVariantOptions(item.variantOptions);
      const background = index % 2 === 0 ? '#FFFFFF' : BRAND_PRIMARY_SOFT;

      return `<tr style="background:${background};">
        <td style="padding:14px 12px;border-bottom:1px solid ${BORDER};vertical-align:top;">
          <div style="font-size:14px;font-weight:600;color:${TEXT_PRIMARY};margin-bottom:4px;">${escapeHtml(item.productName)}</div>
          ${variant ? `<div style="font-size:12px;color:${TEXT_MUTED};">${escapeHtml(variant)}</div>` : ''}
        </td>
        <td style="padding:14px 8px;border-bottom:1px solid ${BORDER};font-size:13px;color:${TEXT_SECONDARY};text-align:center;vertical-align:top;">${item.quantity}</td>
        <td style="padding:14px 8px;border-bottom:1px solid ${BORDER};font-size:13px;color:${TEXT_SECONDARY};text-align:right;vertical-align:top;">฿${formatCurrency(item.unitPrice)}</td>
        <td style="padding:14px 12px;border-bottom:1px solid ${BORDER};font-size:14px;font-weight:600;color:${TEXT_PRIMARY};text-align:right;vertical-align:top;">฿${formatCurrency(item.subtotal)}</td>
      </tr>`;
    })
    .join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
    <tr style="background:${BRAND_PRIMARY_LIGHT};">
      <th align="left" style="padding:12px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">สินค้า</th>
      <th style="padding:12px 8px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">จำนวน</th>
      <th align="right" style="padding:12px 8px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">ราคา</th>
      <th align="right" style="padding:12px;font-size:12px;color:${BRAND_PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.04em;">รวม</th>
    </tr>
    ${rows}
  </table>`;
}

function totalsPanel(params: {
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  total: number;
}): string {
  const rows = [
    { label: 'ยอดสินค้า', value: `฿${formatCurrency(params.subtotal)}`, emphasize: false },
    ...(params.discountAmount > 0
      ? [{ label: 'ส่วนลด', value: `-฿${formatCurrency(params.discountAmount)}`, emphasize: false }]
      : []),
    { label: 'ค่าจัดส่ง', value: `฿${formatCurrency(params.shippingFee)}`, emphasize: false },
    { label: 'ยอดชำระทั้งหมด', value: `฿${formatCurrency(params.total)}`, emphasize: true },
  ];

  const cells = rows
    .map((row) => {
      const labelStyle = row.emphasize
        ? `font-size:15px;font-weight:700;color:${TEXT_PRIMARY};`
        : `font-size:13px;color:${TEXT_MUTED};`;
      const valueStyle = row.emphasize
        ? `font-size:20px;font-weight:700;color:${BRAND_PRIMARY_DARK};`
        : `font-size:14px;font-weight:600;color:${TEXT_PRIMARY};`;

      return `<tr>
        <td style="padding:8px 0;${labelStyle}">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;text-align:right;${valueStyle}">${escapeHtml(row.value)}</td>
      </tr>`;
    })
    .join('');

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;">
    <tr><td style="padding:18px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0">${cells}</table>
    </td></tr>
  </table>`;
}

export function vendorInviteTemplate(
  brand: EmailTemplateBrand,
  params: { inviteUrl: string },
): EmailTemplateResult {
  const subject = 'คำเชิญเข้าร่วม SOPet ในฐานะผู้ขาย';
  const text = `คุณได้รับเชิญให้เข้าร่วม SOPet ในฐานะผู้ขาย กรุณาเปิดลิงก์นี้เพื่อสมัคร: ${params.inviteUrl}`;
  const html = layout(
    brand,
    `
    ${heroBadge('คำเชิญพิเศษ')}
    ${sectionTitle('ยินดีต้อนรับสู่ทีมผู้ขาย SOPet', 'เริ่มต้นขายสินค้าสำหรับสัตว์เลี้ยงบนแพลตฟอร์มที่ลูกค้าไว้วางใจ')}
    ${highlightBox('คุณได้รับเชิญให้เปิดร้านค้าบน SOPet กรุณาตั้งรหัสผ่านและเริ่มจัดการสินค้า คำสั่งซื้อ และโปรโมชันของร้านคุณได้ทันที')}
    ${infoPanel([
      { label: 'บทบาท', value: 'ผู้ขาย (Vendor)' },
      { label: 'สิทธิ์การใช้งาน', value: 'จัดการร้านค้าและสินค้า' },
      { label: 'อายุลิงก์', value: '7 วัน' },
    ])}
    ${cta(params.inviteUrl, 'ยอมรับคำเชิญและเริ่มต้น', 'ลิงก์นี้จะหมดอายุภายใน 7 วัน')}
    ${note('หากคุณไม่ได้คาดหวังอีเมลนี้ สามารถเพิกเฉยได้อย่างปลอดภัย')}
  `,
    subject,
  );

  return { subject, html, text };
}

export function adminInviteTemplate(
  brand: EmailTemplateBrand,
  params: { inviteUrl: string },
): EmailTemplateResult {
  const subject = 'คำเชิญเข้าร่วมทีมผู้ดูแลระบบ SOPet';
  const text = `คุณได้รับเชิญให้เป็นผู้ดูแลระบบ SOPet กรุณาเปิดลิงก์นี้: ${params.inviteUrl}`;
  const html = layout(
    brand,
    `
    ${heroBadge('ทีมผู้ดูแลระบบ')}
    ${sectionTitle('คำเชิญเป็นผู้ดูแลระบบ', 'เข้าร่วมทีมงานเพื่อดูแลแพลตฟอร์ม SOPet')}
    ${highlightBox('คุณได้รับสิทธิ์เข้าถึงระบบผู้ดูแลแพลตฟอร์ม กรุณาตั้งรหัสผ่านก่อนเข้าใช้งานครั้งแรก')}
    ${infoPanel([
      { label: 'บทบาท', value: 'ผู้ดูแลระบบ (Admin)' },
      { label: 'การเข้าถึง', value: 'แผงควบคุมแพลตฟอร์ม' },
      { label: 'อายุลิงก์', value: '7 วัน' },
    ])}
    ${cta(params.inviteUrl, 'ยอมรับคำเชิญ', 'ลิงก์นี้จะหมดอายุภายใน 7 วัน')}
  `,
    subject,
  );

  return { subject, html, text };
}

export function storeMemberInviteTemplate(
  brand: EmailTemplateBrand,
  params: { inviteUrl: string; storeName: string },
): EmailTemplateResult {
  const subject = `คำเชิญเข้าร่วมทีมร้าน ${params.storeName}`;
  const text = `คุณได้รับเชิญให้เข้าร่วมทีมร้าน ${params.storeName} บน SOPet: ${params.inviteUrl}`;
  const html = layout(
    brand,
    `
    ${heroBadge('ทีมร้านค้า')}
    ${sectionTitle('เข้าร่วมทีมร้านของคุณ', `คุณได้รับเชิญให้ช่วยดูแลร้าน ${params.storeName} บน SOPet`)}
    ${highlightBox('หลังจากยอมรับคำเชิญ คุณจะสามารถเข้าถึงแดชบอร์ดร้านค้า จัดการออเดอร์ และทำงานร่วมกับทีมได้ทันที')}
    ${infoPanel([
      { label: 'ร้านค้า', value: params.storeName },
      { label: 'สิทธิ์', value: 'สมาชิกทีมร้าน' },
      { label: 'อายุลิงก์', value: '7 วัน' },
    ])}
    ${cta(params.inviteUrl, 'ยอมรับคำเชิญ', 'ลิงก์นี้จะหมดอายุภายใน 7 วัน')}
  `,
    subject,
  );

  return { subject, html, text };
}

export function passwordResetTemplate(
  brand: EmailTemplateBrand,
  params: { resetUrl: string },
): EmailTemplateResult {
  const subject = 'รีเซ็ตรหัสผ่าน SOPet';
  const text = `กรุณาเปิดลิงก์นี้เพื่อรีเซ็ตรหัสผ่านของคุณ: ${params.resetUrl}`;
  const html = layout(
    brand,
    `
    ${heroBadge('ความปลอดภัยบัญชี', 'info')}
    ${sectionTitle('รีเซ็ตรหัสผ่าน', 'เราได้รับคำขอให้รีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ')}
    ${highlightBox('หากคุณเป็นผู้ร้องขอ กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ หากไม่ใช่ กรุณาเพิกเฉยอีเมลนี้')}
    ${infoPanel([
      { label: 'การดำเนินการ', value: 'ตั้งรหัสผ่านใหม่' },
      { label: 'อายุลิงก์', value: '1 ชั่วโมง' },
      { label: 'คำแนะนำ', value: 'ใช้ลิงก์เพียงครั้งเดียว' },
    ])}
    ${cta(params.resetUrl, 'ตั้งรหัสผ่านใหม่', 'ลิงก์นี้จะหมดอายุภายใน 1 ชั่วโมง')}
  `,
    subject,
  );

  return { subject, html, text };
}

export function emailVerificationTemplate(
  brand: EmailTemplateBrand,
  params: { verifyUrl: string },
): EmailTemplateResult {
  const subject = 'ยืนยันอีเมล SOPet';
  const text = `กรุณาเปิดลิงก์นี้เพื่อยืนยันอีเมลของคุณ: ${params.verifyUrl}`;
  const html = layout(
    brand,
    `
    ${heroBadge('ยืนยันอีเมล', 'info')}
    ${sectionTitle('ยืนยันอีเมลของคุณ', 'กรุณายืนยันอีเมลเพื่อใช้งานบัญชีผู้ขายบน SOPet')}
    ${highlightBox('หากคุณเป็นผู้ร้องขอ กรุณากดปุ่มด้านล่างเพื่อยืนยันอีเมล หากไม่ใช่ กรุณาเพิกเฉยอีเมลนี้')}
    ${infoPanel([
      { label: 'การดำเนินการ', value: 'ยืนยันอีเมล' },
      { label: 'อายุลิงก์', value: '24 ชั่วโมง' },
      { label: 'คำแนะนำ', value: 'ใช้ลิงก์เพียงครั้งเดียว' },
    ])}
    ${cta(params.verifyUrl, 'ยืนยันอีเมล', 'ลิงก์นี้จะหมดอายุภายใน 24 ชั่วโมง')}
  `,
    subject,
  );

  return { subject, html, text };
}

export function orderPaidTemplate(
  brand: EmailTemplateBrand,
  params: {
    orderNumber: string;
    orderDate: string;
    paymentMethod: string;
    customerName?: string;
    items: OrderPaidLineItem[];
    subtotal: number;
    discountAmount: number;
    shippingFee: number;
    total: number;
    orderUrl: string;
  },
): EmailTemplateResult {
  const formattedTotal = formatCurrency(params.total);
  const subject = `ชำระเงินสำเร็จ — คำสั่งซื้อ ${params.orderNumber}`;
  const itemSummary = params.items
    .map((item) => `${item.productName} x${item.quantity} = ฿${formatCurrency(item.subtotal)}`)
    .join('; ');
  const text = `ขอบคุณที่ชำระเงินสำหรับคำสั่งซื้อ ${params.orderNumber} ยอดรวม ฿${formattedTotal}. รายการ: ${itemSummary}. ดูรายละเอียด: ${params.orderUrl}`;

  const html = layout(
    brand,
    `
    ${heroBadge('ชำระเงินสำเร็จ', 'success')}
    ${sectionTitle('ขอบคุณสำหรับคำสั่งซื้อ', 'เราได้รับการชำระเงินของคุณเรียบร้อยแล้ว และกำลังเตรียมคำสั่งซื้อให้คุณ')}
    ${infoPanel([
      { label: 'หมายเลขคำสั่งซื้อ', value: params.orderNumber },
      { label: 'วันที่สั่งซื้อ', value: params.orderDate },
      { label: 'ช่องทางชำระเงิน', value: formatPaymentMethod(params.paymentMethod) },
      ...(params.customerName ? [{ label: 'ผู้สั่งซื้อ', value: params.customerName }] : []),
    ])}
    <h2 style="margin:0 0 12px;font-size:16px;color:${BRAND_PRIMARY_DARK};">รายการสินค้า</h2>
    ${orderItemsTable(params.items)}
    ${totalsPanel(params)}
    ${cta(params.orderUrl, 'ดูรายละเอียดคำสั่งซื้อ')}
    ${note('เราจะแจ้งอัปเดตสถานะการจัดส่งให้คุณทราบผ่านอีเมลนี้')}
  `,
    subject,
  );

  return { subject, html, text };
}

export function orderStatusChangedTemplate(
  brand: EmailTemplateBrand,
  params: {
    orderNumber: string;
    status: string;
    orderDate?: string;
    orderUrl: string;
  },
): EmailTemplateResult {
  const statusLabel = formatOrderStatus(params.status);
  const subject = `คำสั่งซื้อ ${params.orderNumber} — ${statusLabel}`;
  const text = `คำสั่งซื้อ ${params.orderNumber} อัปเดตสถานะเป็น ${statusLabel}. ติดตามคำสั่งซื้อ: ${params.orderUrl}`;
  const html = layout(
    brand,
    `
    ${heroBadge(`สถานะ: ${statusLabel}`, 'info')}
    ${sectionTitle('อัปเดตคำสั่งซื้อของคุณ', 'มีการเปลี่ยนแปลงสถานะคำสั่งซื้อล่าสุด')}
    ${highlightBox(`คำสั่งซื้อ <strong>${escapeHtml(params.orderNumber)}</strong> ของคุณตอนนี้อยู่ในสถานะ <strong>${escapeHtml(statusLabel)}</strong>`)}
    ${infoPanel([
      { label: 'หมายเลขคำสั่งซื้อ', value: params.orderNumber },
      { label: 'สถานะปัจจุบัน', value: statusLabel },
      ...(params.orderDate ? [{ label: 'วันที่สั่งซื้อ', value: params.orderDate }] : []),
    ])}
    ${cta(params.orderUrl, 'ติดตามคำสั่งซื้อ')}
    ${note('คุณสามารถตรวจสอบรายละเอียดและประวัติการจัดส่งได้จากลิงก์ด้านบน')}
  `,
    subject,
  );

  return { subject, html, text };
}
