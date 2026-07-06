const BRAND_COLOR = '#C4612F';
const CREAM = '#F7F4EF';

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:'Noto Sans Thai',Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e4de;">
        <tr><td style="background:${BRAND_COLOR};padding:24px 32px;">
          <span style="color:#fff;font-size:22px;font-weight:600;">SOPet</span>
        </td></tr>
        <tr><td style="padding:32px;">${content}</td></tr>
        <tr><td style="padding:16px 32px 24px;font-size:12px;color:#888;border-top:1px solid #e8e4de;">
          อีเมลนี้ส่งจาก SOPet Marketplace · กรุณาอย่าตอบกลับอีเมลนี้
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function cta(href: string, label: string): string {
  return `<p style="margin:28px 0 0;">
    <a href="${href}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">${label}</a>
  </p>`;
}

export interface EmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

export function vendorInviteTemplate(params: { inviteUrl: string }): EmailTemplateResult {
  const subject = 'คำเชิญเข้าร่วม SOPet ในฐานะผู้ขาย';
  const text = `คุณได้รับเชิญให้เข้าร่วม SOPet ในฐานะผู้ขาย กรุณาเปิดลิงก์นี้เพื่อสมัคร: ${params.inviteUrl}`;
  const html = layout(`
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;">คำเชิญเป็นผู้ขาย</h1>
    <p style="margin:0;line-height:1.6;color:#444;">คุณได้รับเชิญให้เข้าร่วมแพลตฟอร์ม SOPet ในฐานะผู้ขาย กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านและเริ่มใช้งาน</p>
    ${cta(params.inviteUrl, 'ยอมรับคำเชิญ')}
    <p style="margin:24px 0 0;font-size:13px;color:#888;">ลิงก์นี้จะหมดอายุภายใน 7 วัน</p>
  `);
  return { subject, html, text };
}

export function adminInviteTemplate(params: { inviteUrl: string }): EmailTemplateResult {
  const subject = 'คำเชิญเข้าร่วมทีมผู้ดูแลระบบ SOPet';
  const text = `คุณได้รับเชิญให้เป็นผู้ดูแลระบบ SOPet กรุณาเปิดลิงก์นี้: ${params.inviteUrl}`;
  const html = layout(`
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;">คำเชิญเป็นผู้ดูแลระบบ</h1>
    <p style="margin:0;line-height:1.6;color:#444;">คุณได้รับเชิญให้เข้าร่วมทีมผู้ดูแลระบบ SOPet กรุณาคลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่าน</p>
    ${cta(params.inviteUrl, 'ยอมรับคำเชิญ')}
    <p style="margin:24px 0 0;font-size:13px;color:#888;">ลิงก์นี้จะหมดอายุภายใน 7 วัน</p>
  `);
  return { subject, html, text };
}

export function storeMemberInviteTemplate(params: {
  inviteUrl: string;
  storeName: string;
}): EmailTemplateResult {
  const subject = `คำเชิญเข้าร่วมทีมร้าน ${params.storeName}`;
  const text = `คุณได้รับเชิญให้เข้าร่วมทีมร้าน ${params.storeName} บน SOPet: ${params.inviteUrl}`;
  const html = layout(`
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;">คำเชิญเข้าร่วมทีมร้าน</h1>
    <p style="margin:0;line-height:1.6;color:#444;">คุณได้รับเชิญให้เข้าร่วมทีมร้าน <strong>${params.storeName}</strong> บน SOPet</p>
    ${cta(params.inviteUrl, 'ยอมรับคำเชิญ')}
    <p style="margin:24px 0 0;font-size:13px;color:#888;">ลิงก์นี้จะหมดอายุภายใน 7 วัน</p>
  `);
  return { subject, html, text };
}

export function passwordResetTemplate(params: { resetUrl: string }): EmailTemplateResult {
  const subject = 'รีเซ็ตรหัสผ่าน SOPet';
  const text = `กรุณาเปิดลิงก์นี้เพื่อรีเซ็ตรหัสผ่านของคุณ: ${params.resetUrl}`;
  const html = layout(`
    <h1 style="margin:0 0 12px;font-size:20px;color:#1a1a1a;">รีเซ็ตรหัสผ่าน</h1>
    <p style="margin:0;line-height:1.6;color:#444;">เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยอีเมลนี้</p>
    ${cta(params.resetUrl, 'ตั้งรหัสผ่านใหม่')}
    <p style="margin:24px 0 0;font-size:13px;color:#888;">ลิงก์นี้จะหมดอายุภายใน 1 ชั่วโมง</p>
  `);
  return { subject, html, text };
}
