# SOPet Multi-Vendor E-Commerce Backend

NestJS backend API for a multi-vendor e-commerce platform with Omise payment integration and comprehensive vendor management.

## Features

- **Multi-Vendor Support**: Vendors can register, manage stores, products, and orders
- **Customer Authentication**: Phone OTP authentication for customers
- **Vendor/Admin Authentication**: Email + password authentication with JWT tokens
- **Payment Integration**: Omise payment gateway (PromptPay, Credit Card, COD)
- **Product Management**: Full CRUD with variants, images, and inventory tracking
- **Order Management**: Multi-store checkout with order tracking
- **Reviews & Ratings**: Customer reviews and vendor responses
- **Admin Panel**: Store approval, dispute management, payout processing

## Tech Stack

- **Framework**: NestJS 11 with TypeScript
- **Database**: PostgreSQL 15+ with TypeORM
- **Authentication**: JWT tokens with Passport
- **Validation**: class-validator and class-transformer
- **Payment**: Omise SDK
- **SMS**: Twilio (for OTP delivery)
- **Storage**: AWS S3 / CloudFlare R2

## Description

Custom-built backend replacing Medusa.js for better performance and multi-vendor support.

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Yarn 1.22+

### Installation

```bash
# Install dependencies
yarn install

# Copy environment variables
cp .env.example .env

# Update .env with your database credentials
```

### Database Setup

```bash
# Create database
createdb sopet

# Run migrations (if available)
yarn migration:run

# Or sync schema (development only)
yarn schema:sync
```

### Database reset & seeding

```bash
# Local only — drop schema, run migrations, seed admin + vendor + demo catalog
yarn db:reset:dev

# Seed development data without dropping (idempotent)
yarn db:seed:dev

# Production bootstrap — admin account only, idempotent (safe on live DB)
yarn db:seed:prod
```

**Default credentials (dev seed):**

| Role   | Email            | Password |
| ------ | ---------------- | -------- |
| Admin  | admin@sopet.org  | P@ssw0rd |
| Vendor | vendor@sopet.org | P@ssw0rd |

`db:reset:dev` refuses to run when `NODE_ENV=production` or when the database host
does not look local. Allowed local hosts: `localhost`, `127.0.0.1`, `::1`,
`*.orb.local` (OrbStack), `*.docker.internal` / `host.docker.internal` (Docker
Desktop), and `*.local`. Managed/cloud hosts (RDS/Aurora, Supabase, Neon,
PlanetScale, etc.) are always blocked. For an unrecognized local host, set
`DB_RESET_ALLOW=1` (or `ALLOW_DB_RESET=true`) to override the host check — this
does not bypass the `NODE_ENV=production` or production-host guards.
`db:seed:prod` is for **initial production bootstrap only** — it creates
`admin@sopet.org` if missing and does not wipe existing data. Change the default
password after first login.

### Running the Application

```bash
# Development mode with hot-reload
yarn start:dev

# Production mode
yarn build
yarn start:prod
```

The API will be available at `http://localhost:3002/graphql`

GraphQL Playground / Apollo Sandbox is served at the same URL in development.

## API

### GraphQL (`POST /graphql`)

All application features (auth, catalog, cart, checkout, orders, payments, admin, etc.) are exposed through **GraphQL** at `/graphql`. Use the schema introspection or see `.full-stack-feature/05-backend-impl.md` in the workspace for the operation list.

Admin (`sopet-admin`) and storefront (`sopet-storefront`) call `/graphql` exclusively.

### Inbound REST (third-party webhooks only)

| Route                  | Auth                                          | Purpose                           |
| ---------------------- | --------------------------------------------- | --------------------------------- |
| `POST /webhooks/omise` | Omise HMAC signature (`OMISE_WEBHOOK_SECRET`) | Payment status updates from Omise |

There are **no** `/v1/*` REST routes for app features.

#### Omise webhook setup

1. In the [Omise dashboard](https://dashboard.omise.co/), set the webhook URL to `https://<your-api-host>/webhooks/omise`.
2. Copy the webhook signing secret into `.env`:

```bash
OMISE_WEBHOOK_SECRET=<base64-secret-from-omise-dashboard>
```

3. The backend verifies each request using headers `Omise-Signature` and `Omise-Signature-Timestamp` (HMAC-SHA256 over `{timestamp}.{rawBody}`). Invalid signatures receive `401`.
4. When `OMISE_WEBHOOK_SECRET` is empty (local dev), signature verification is **skipped** with a logged warning — do not use this in production.

For local testing, expose your dev server with ngrok or cloudflared and point Omise at the tunnel URL.

## Project Structure

```
src/
├── common/                 # Shared utilities
│   ├── decorators/        # Custom decorators
│   ├── filters/           # Exception filters
│   ├── guards/            # Auth guards
│   ├── interceptors/      # Request/response interceptors
│   ├── interfaces/        # Common interfaces
│   └── pipes/             # Validation pipes
├── config/                # Configuration files
│   ├── app.config.ts
│   ├── jwt.config.ts
│   ├── omise.config.ts
│   ├── storage.config.ts
│   └── twilio.config.ts
├── database/              # Database layer
│   ├── entities/          # TypeORM entities
│   └── repositories/      # Custom repositories
├── modules/               # Feature modules
│   ├── auth/             # Authentication
│   ├── users/            # User management
│   ├── stores/           # Store management
│   ├── products/         # Product management
│   ├── orders/           # Order management
│   └── payments/         # Payment processing
├── app.module.ts          # Root module
└── main.ts                # Application entry point
```

## Implemented Modules

✅ **AuthModule** - Complete OTP authentication, JWT tokens, guards
✅ **UsersModule** - Customer profile, saved addresses
✅ **StoresModule** - Store registration, approval workflow
✅ **ProductsModule** - Full CRUD, variants, images, search
✅ **OrdersModule** - Order creation, status tracking
✅ **PaymentsModule** - Omise integration structure

## Pending Implementation

The following modules have basic structure but need full implementation:

- **PromotionsModule** - Promotion codes and validation
- **ReviewsModule** - Product reviews and ratings
- **DisputesModule** - Dispute management
- **PayoutsModule** - Vendor payout calculation
- **NotificationsModule** - Email/SMS notifications

## Object Storage (images)

Image uploads (`uploadImage` mutation → `StorageService`) use the **AWS SDK v3**
(`@aws-sdk/client-s3`) with `PutObjectCommand`, so requests are signed with AWS
Signature V4 (`AWS4-HMAC-SHA256`). This works against real AWS S3, MinIO, and
Cloudflare R2. Uploaded images are converted to WebP before upload.

Configuration by target (set `STORAGE_PROVIDER`):

- **MinIO (local, `STORAGE_PROVIDER=s3`)**: set `AWS_S3_ENDPOINT=http://localhost:9000`
  and `AWS_S3_FORCE_PATH_STYLE=true` (path-style is required by MinIO). Public URLs
  are built from `AWS_S3_PUBLIC_URL`.
- **AWS S3 (`STORAGE_PROVIDER=s3`)**: leave `AWS_S3_ENDPOINT` empty and set
  `AWS_S3_FORCE_PATH_STYLE=false`; point `AWS_S3_PUBLIC_URL` at your CDN/bucket URL.
- **Cloudflare R2 (`STORAGE_PROVIDER=r2`)**: set `CLOUDFLARE_ACCOUNT_ID`,
  `CLOUDFLARE_ACCESS_KEY_ID`, `CLOUDFLARE_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET`.
  The endpoint (`https://<account-id>.r2.cloudflarestorage.com`) is derived
  automatically and public URLs come from `CDN_URL`.

### Public read

The storefront/admin render images by their public URL, so the bucket must allow
public reads. Prefer a **bucket policy** over per-object ACLs (many MinIO setups
reject `x-amz-acl`). For local MinIO this is done automatically by the
`minio-init` service in `docker-compose.yml`:

```bash
mc anonymous set download local/sopet-ecommerce-files
```

If you need per-object ACLs instead (and the bucket supports them), set
`AWS_S3_OBJECT_ACL=public-read`; it is omitted from the request when empty.

## Environment Variables

See `.env.example` for all required environment variables.

Key variables:

- `DB_*` - PostgreSQL connection
- `JWT_SECRET` - JWT signing key
- `OMISE_PUBLIC_KEY`, `OMISE_SECRET_KEY` - Omise API credentials
- `OMISE_WEBHOOK_SECRET` - Base64 webhook signing secret from Omise dashboard (required in production)
- `TWILIO_*` - Twilio SMS credentials
- `RESEND_API_KEY` - Resend transactional email
- `REDIS_*` - Redis cache/session
- `STORAGE_PROVIDER`, `AWS_*` / `CLOUDFLARE_*` - object storage (S3/MinIO/R2) credentials and config (see Object Storage above)
