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

### Deploy: `self-signed certificate in certificate chain` during `migration:show`

UAT uses **Crunchy Bridge** (`*.db.postgresbridge.com`), which presents a team-private self-signed root. Pointing `DB_SSL_CA` at the Amazon RDS bundle replaces Node’s trust store with the wrong CAs and fails with `SELF_SIGNED_CERT_IN_CHAIN`.

`getPostgresSslOptions()` encrypts Crunchy Bridge connections and skips peer verify unless a team CA is set on `DB_SSL_CA`. Amazon RDS hosts still use `infra/certs/rds-global-bundle.pem`.

If an RDS host fails after a CA rotation, refresh the bundle:

```bash
curl -fsSL -o infra/certs/rds-global-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`. `DB_SSL_REJECT_UNAUTHORIZED=false` is break-glass only.

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

- Templates use an absolute logo URL: `EMAIL_LOGO_URL` if set, otherwise `${API_URL}/images/email/sopet-logo-white.png`. When `API_URL` is localhost, the public fallback `https://api.sopet.org/images/email/sopet-logo-white.png` is used so real inboxes can load the image.
- Locally, open `http://localhost:3002/images/email/sopet-logo-white.png` while `yarn start:dev` is running (asset still served for direct checks).
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

## Deploy (SSM) failures

### `Timed out after Ns waiting for SSM` with Status `InProgress`, empty stdout/stderr

Usually **not** “SSM agent offline”. `InProgress` means the agent accepted the command. Empty output is expected until the remote script finishes unless CloudWatch output is enabled.

Most common causes:

1. **`BUILD_ON_HOST=true`**: native `docker build` on EC2 still running longer than the GHA waiter (3600s). Default arm64 path builds on GHA (`ubuntu-24.04-arm`) and EC2 only pulls — if you see long InProgress without that flag, check `deploy.sh` / disk / docker pull.
2. **Disk full** on a small root volume (pull or leftover build cache)
3. **Hung docker** (less common) — check processes on the instance

```bash
aws ssm get-command-invocation \
  --command-id <COMMAND_ID> \
  --instance-id <EC2_INSTANCE_ID> \
  --region <AWS_REGION>
```

See [Deployment — Inspect a stuck SSM command](deployment.md#inspect-a-stuck--timed-out-ssm-command).

## Related docs

- [Deployment](deployment.md)
- [Deploy production](deploy-production.md)
- [Database](database.md)
