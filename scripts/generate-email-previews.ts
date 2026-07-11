import { copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  adminInviteTemplate,
  orderPaidTemplate,
  orderStatusChangedTemplate,
  passwordResetTemplate,
  storeMemberInviteTemplate,
  vendorInviteTemplate,
} from '../src/modules/email/email-templates';

const outDir = join(__dirname, '../temp/email-previews');
const assetsDir = join(outDir, 'assets');
const brand = {
  logoUrl: './assets/sopet-logo-white.svg',
};

mkdirSync(assetsDir, { recursive: true });
copyFileSync(
  join(__dirname, '../../sopet-storefront/public/images/email/sopet-logo-white.svg'),
  join(assetsDir, 'sopet-logo-white.svg'),
);
mkdirSync(outDir, { recursive: true });

const previews = [
  {
    file: '01-vendor-invite.html',
    template: vendorInviteTemplate(brand, {
      inviteUrl: 'https://admin.sopet.co.th/register?token=mock-vendor-token',
    }),
  },
  {
    file: '02-admin-invite.html',
    template: adminInviteTemplate(brand, {
      inviteUrl: 'https://admin.sopet.co.th/register?adminToken=mock-admin-token',
    }),
  },
  {
    file: '03-store-member-invite.html',
    template: storeMemberInviteTemplate(brand, {
      inviteUrl: 'https://admin.sopet.co.th/invite/store?token=mock-store-token',
      storeName: 'เพ็ทแฮปปี้',
    }),
  },
  {
    file: '04-password-reset.html',
    template: passwordResetTemplate(brand, {
      resetUrl: 'https://admin.sopet.co.th/reset-password?token=mock-reset-token',
    }),
  },
  {
    file: '05-order-paid.html',
    template: orderPaidTemplate(brand, {
      orderNumber: 'ORD-20250711-0042',
      orderDate: '11 กรกฎาคม 2568 เวลา 20:15',
      paymentMethod: 'promptpay',
      customerName: 'คุณมานี ใจดี',
      items: [
        {
          productName: 'อาหารแมว Premium Salmon',
          variantOptions: { ขนาด: '1.5kg', รสชาติ: 'ปลาแซลมอน' },
          quantity: 2,
          unitPrice: 459,
          subtotal: 918,
        },
        {
          productName: 'ทรายแมวภูเขาไฟ',
          variantOptions: { น้ำหนัก: '10L' },
          quantity: 1,
          unitPrice: 299,
          subtotal: 299,
        },
        {
          productName: 'ของเล่นแมวปลาใบไม้',
          quantity: 1,
          unitPrice: 189,
          subtotal: 189,
        },
      ],
      subtotal: 1406,
      discountAmount: 100,
      shippingFee: 79,
      total: 1385,
      orderUrl: 'https://sopet.co.th/account/orders/mock-order-id',
    }),
  },
  {
    file: '06-order-status-changed.html',
    template: orderStatusChangedTemplate(brand, {
      orderNumber: 'ORD-20250711-0042',
      status: 'shipped',
      orderDate: '11 กรกฎาคม 2568 เวลา 20:15',
      orderUrl: 'https://sopet.co.th/account/orders/mock-order-id',
    }),
  },
];

for (const preview of previews) {
  writeFileSync(join(outDir, preview.file), preview.template.html, 'utf8');
}

const indexHtml = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SOPet Email Previews</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; padding: 40px 24px; font-family: 'Noto Sans Thai', Arial, sans-serif; background: #F9F6FE; color: #1A1A1A; }
    .wrap { max-width: 760px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    .sub { margin: 0 0 28px; color: #5C5C5C; line-height: 1.6; }
    .grid { display: grid; gap: 12px; }
    a.card { display: block; background: #fff; border: 1px solid #E7DBF9; border-radius: 16px; padding: 20px 24px; text-decoration: none; color: inherit; }
    a.card:hover { border-color: #9C6ADE; box-shadow: 0 8px 24px rgba(156,106,222,0.14); }
    .card h2 { margin: 0 0 6px; font-size: 18px; color: #884ECF; }
    .card p { margin: 0; font-size: 14px; color: #5C5C5C; }
    .badge { display: inline-block; margin-top: 10px; font-size: 12px; color: #884ECF; background: #F2EBFC; padding: 4px 10px; border-radius: 999px; }
    .note { margin-top: 28px; padding: 16px 20px; background: #fff; border: 1px solid #E7DBF9; border-radius: 12px; font-size: 13px; color: #666; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>SOPet Email Previews</h1>
    <p class="sub">Generated from <code>src/modules/email/email-templates.ts</code> with SOPet brand primary <strong>#9C6ADE</strong> and logo header.</p>
    <div class="grid">
      ${previews
        .map(
          (preview, index) => `<a class="card" href="${preview.file}" target="_blank">
        <h2>${index + 1}. ${preview.template.subject}</h2>
        <p>Open rendered HTML preview</p>
        <span class="badge">${preview.file}</span>
      </a>`,
        )
        .join('')}
    </div>
    <p class="note">Regenerate anytime with <code>yarn email:previews</code>. Logo path in previews is local for browser viewing.</p>
  </div>
</body>
</html>`;

writeFileSync(join(outDir, 'index.html'), indexHtml, 'utf8');

console.log(`Generated ${previews.length} email previews in ${outDir}`);
