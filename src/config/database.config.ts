import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'sopet_ecommerce',
  ssl:
    process.env.DB_SSL === 'true'
      ? {
          rejectUnauthorized: process.env.NODE_ENV === 'production',
        }
      : false,
  poolMax: parseInt(process.env.DB_POOL_MAX ?? '20', 10) || 20,
  logging: process.env.NODE_ENV === 'development',
}));
