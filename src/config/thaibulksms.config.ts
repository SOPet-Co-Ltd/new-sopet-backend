import { registerAs } from '@nestjs/config';

export default registerAs('thaibulksms', () => ({
  apiKey: process.env.THAIBULKSMS_API_KEY || '',
  apiSecret: process.env.THAIBULKSMS_API_SECRET || '',
  sender: process.env.THAIBULKSMS_SENDER || 'SOPet',
}));
