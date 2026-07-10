import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

// Base64 image uploads via the `uploadImage` GraphQL mutation can exceed the
// default ~100kb body-parser limit. 10mb comfortably fits the client's 5MB
// image cap once base64-encoded (~33% overhead).
const BODY_LIMIT = '10mb';

async function bootstrap() {
  // `bodyParser: false` skips Nest's default (100kb) parser registration so we
  // can register our own with a larger limit below. `rawBody: true` is still
  // honored by `useBodyParser`, preserving `req.rawBody` for the Omise webhook
  // HMAC signature verification.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });

  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: BODY_LIMIT });

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

  const apiUrl = process.env.API_URL?.replace(/\/$/, '') || `http://localhost:${port}`;

  console.log(`🚀 SOPet API: ${apiUrl}/graphql`);
  console.log(`🔌 GraphQL subscriptions: ${apiUrl.replace(/^http/, 'ws')}/graphql`);
  console.log(`🔗 Omise webhook: ${apiUrl}/webhooks/omise`);
  console.log(
    `🔑 Public API: ${apiUrl}/api/v1/stores/{storeId} (Authorization: Bearer sopet_sk_...)`,
  );
}

bootstrap();
