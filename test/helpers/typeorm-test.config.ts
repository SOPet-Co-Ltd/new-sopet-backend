import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { configurePgUtcTimestampParsing } from '../../src/database/pg-timestamp.util';
import { getPostgresSslOptions } from '../../src/database/postgres-ssl.util';

config();
configurePgUtcTimestampParsing();

export function createTypeOrmTestOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'sopet_ecommerce',
    entities: [join(process.cwd(), 'src/database/entities/*.entity.ts')],
    synchronize: false,
    logging: false,
    ssl: getPostgresSslOptions(),
  };
}
