import { join } from 'path';
import * as express from 'express';
import type { OptionsJson } from 'body-parser';
import { configurePgUtcTimestampParsing } from './database/pg-timestamp.util';

configurePgUtcTimestampParsing();

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertProductionSecurityConfig } from './config/security-boot.util';

// Base64 image uploads via the `uploadImage` GraphQL mutation can exceed the
// default ~100kb body-parser limit. 10mb comfortably fits the client's 5MB
// image cap once base64-encoded (~33% overhead).
const GRAPHQL_BODY_LIMIT = '10mb';
/** Smaller JSON limit for REST public API and payment webhooks (SOPET-L-01). */
const REST_BODY_LIMIT = '256kb';

async function bootstrap() {
  assertProductionSecurityConfig();

  // `bodyParser: false` skips Nest's default (100kb) parser registration so we
  // can register path-specific parsers below. `rawBody: true` is still honored
  // by Nest's body parser helpers for Omise webhook HMAC verification; we also
  // set rawBody on the webhook path via verify().
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });

  app.use(
    helmet({
      // GraphQL Playground / Apollo Sandbox need relaxed CSP in non-production.
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      // API is consumed cross-origin by storefront/admin; CORP handled via CORS.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const captureRawBody: OptionsJson['verify'] = (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  };

  // Path-specific smaller limits first (SOPET-L-01)
  app.use('/webhooks/omise', express.json({ limit: REST_BODY_LIMIT, verify: captureRawBody }));
  app.use('/api/v1', express.json({ limit: REST_BODY_LIMIT }));
  app.use('/api/v1', express.urlencoded({ extended: true, limit: REST_BODY_LIMIT }));

  // GraphQL and other routes keep the larger limit for base64 uploads
  app.useBodyParser('json', { limit: GRAPHQL_BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: GRAPHQL_BODY_LIMIT });

  // Public email/brand assets (e.g. /images/email/sopet-logo-white.png)
  app.useStaticAssets(join(process.cwd(), 'public'));

  const configService = app.get(ConfigService);

  const corsOrigins = configService.get<string[]>('app.corsOrigins');
  if (!corsOrigins || corsOrigins.length === 0) {
    throw new Error('app.corsOrigins must be configured (APP_CORS_ORIGINS env var)');
  }

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = configService.get<number>('app.port') || 3002;
  await app.listen(port);

  const apiUrl =
    configService.get<string>('app.apiUrl') ||
    process.env.API_URL?.replace(/\/$/, '') ||
    `http://localhost:${port}`;

  console.log(`🚀 SOPet API: ${apiUrl}/graphql`);
  console.log(`🔌 GraphQL subscriptions: ${apiUrl.replace(/^http/, 'ws')}/graphql`);
  console.log(`🔗 Omise webhook: ${apiUrl}/webhooks/omise`);
  console.log(
    `🔑 Public API: ${apiUrl}/api/v1/stores/{storeId} (Authorization: Bearer sopet_sk_...)`,
  );
}

bootstrap();
