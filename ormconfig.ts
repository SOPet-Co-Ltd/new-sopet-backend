import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { configurePgUtcTimestampParsing } from './src/database/pg-timestamp.util';
import { getPostgresSslOptions } from './src/database/postgres-ssl.util';

config();
configurePgUtcTimestampParsing();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'sopet_ecommerce',
  entities: ['src/database/entities/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  ssl: getPostgresSslOptions(),
});
