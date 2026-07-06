import { registerAs } from '@nestjs/config';

export default registerAs('resend', () => ({
  apiKey: process.env.RESEND_API_KEY || '',
  from: process.env.EMAIL_FROM || 'noreply@sopet.co.th',
  fromName: process.env.EMAIL_FROM_NAME || 'SOPet Marketplace',
}));
