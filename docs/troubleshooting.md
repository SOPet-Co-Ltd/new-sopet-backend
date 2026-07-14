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

Check `sms.service.ts` delivery chain (order matters):

1. `NODE_ENV=development` **or** `SMS_OTP_LOG_ONLY=true` — OTP logged to console; no provider call
2. ThaiBulkSMS when `THAIBULKSMS_API_KEY` and `THAIBULKSMS_API_SECRET` are set
3. Twilio fallback when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` are set
4. Otherwise `SMS_NOT_CONFIGURED`

GraphQL error codes from `sendCustomerOtp`:

| Code                  | Meaning                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `SMS_NOT_CONFIGURED`  | No ThaiBulkSMS/Twilio credentials on the server                                     |
| `SMS_DELIVERY_FAILED` | Provider API rejected the send (check backend logs for ThaiBulkSMS/Twilio response) |
| `INVALID_PHONE`       | Provider rejected the phone number                                                  |
| `TOO_MANY_ATTEMPTS`   | More than 3 OTP requests in 5 minutes for the same phone                            |

UAT requires GitHub Environment secrets `THAIBULKSMS_API_KEY` and `THAIBULKSMS_API_SECRET` (see `infra/validate-deploy-env.sh`). Optional vars: `THAIBULKSMS_SENDER`, `THAIBULKSMS_FORCE`, `THAIBULKSMS_SHORTEN_URL`.

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

## Email

### Logo missing in received emails

- Templates use `${API_URL}/images/email/sopet-logo-white.png` (PNG, not SVG).
- Locally, open `http://localhost:3002/images/email/sopet-logo-white.png` while `yarn start:dev` is running.
- In UAT/production, set `API_URL` to the **public** HTTPS API hostname (same host clients use for GraphQL). Without it, the logo URL may point at `localhost` and fail for recipients.
- Confirm the Docker image includes `public/` (see `Dockerfile`).

### Emails not sent in development

Expected: `NODE_ENV=development` logs the email body to the backend console instead of calling Resend. Look for `[DEV EMAIL]` / `[dev] …` lines. Set `RESEND_API_KEY` and use a non-development `NODE_ENV` to send for real.

### Local HTML previews

```bash
yarn email:previews
# Open temp/email-previews/*.html in a browser
```

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
