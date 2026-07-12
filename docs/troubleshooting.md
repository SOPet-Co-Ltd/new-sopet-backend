# Troubleshooting

## Database

### Cannot connect to Postgres

```bash
yarn docker:check
# Verify DB_HOST=localhost, DB_NAME=sopet_ecommerce in .env
```

### Migration fails

```bash
yarn migration:revert    # Revert last migration
# Fix entity/migration, then:
yarn migration:run
```

### `db:reset:migrate` / `db:reset:dev` refused

Local reset: point `DB_HOST` at localhost, or set `DB_RESET_ALLOW=1` for unrecognized local hosts.

UAT/prod reset (destructive): set `DB_RESET_ALLOW_PRODUCTION=1` and run `yarn db:reset:migrate` only — not `db:reset:dev` (dev seed stays local-only). Reset drops app tables/enums/routines only (skips extension-owned views on managed Postgres).

## GraphQL

### Schema out of date

```bash
yarn start:dev    # Regenerates src/schema.gql
```

### Playground not loading

Playground disabled when `NODE_ENV=production`.

## Auth

### OTP not received

Check `sms.service.ts` delivery chain:

1. ThaiBulkSMS (if `THAIBULKSMS_API_KEY` set)
2. Twilio fallback
3. Dev mode: OTP logged to console

### JWT errors

- Verify `JWT_SECRET` matches across restarts
- Check token expiry (`JWT_ACCESS_EXPIRES_IN`)
- Customer tokens: `Authorization: Bearer <token>` header

## Storage / images

### Images not loading in frontends

- MinIO bucket must allow public read (`minio-init` sets this in docker-compose)
- Check `AWS_S3_PUBLIC_URL` matches actual bucket URL
- Add MinIO hostname to Next.js `images.remotePatterns`

### Upload fails

- Verify `AWS_S3_ENDPOINT` and `AWS_S3_FORCE_PATH_STYLE=true` for MinIO
- Check bucket exists: http://localhost:9001

## Payments

### Webhook not firing locally

1. Expose dev server via ngrok/cloudflared
2. Point Omise dashboard to `https://<tunnel>/webhooks/omise`
3. Set `OMISE_WEBHOOK_SECRET`

### Webhook signature fails

- `main.ts` requires `rawBody: true` for HMAC
- Secret must match Omise dashboard (base64)

## Redis / BullMQ

### Jobs not processing

```bash
yarn docker:check    # redis-cli ping
# Verify REDIS_HOST, REDIS_PORT in .env
```

## CI failures

| Failure                  | Fix                                             |
| ------------------------ | ----------------------------------------------- |
| `format:check`           | Run `yarn format`                               |
| Coverage below threshold | Add tests for services in `collectCoverageFrom` |
| E2E timeout              | Check mocked dependencies in test bootstrap     |

## Related docs

- [Deployment](deployment.md)
- [Database](database.md)
