import { registerAs } from '@nestjs/config';

export default registerAs('omise', () => ({
  publicKey: process.env.OMISE_PUBLIC_KEY || '',
  secretKey: process.env.OMISE_SECRET_KEY || '',
  webhookSecret: process.env.OMISE_WEBHOOK_SECRET || '',
  apiVersion: '2019-05-29',
}));
