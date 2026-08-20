# Production deploy — SOPET Backend (EC2 + ECR + SSM)

Step-by-step guide to deploy the NestJS API to **production** using the same structure as UAT: GitHub Actions builds the image → Amazon ECR → AWS Systems Manager Run Command on EC2 (pull + restart). Storefront/admin stay on Vercel.

Canonical workflow: `.github/workflows/deploy.yml`  
Key list: `infra/github-env.keys`  
General deploy context: [deployment.md](deployment.md)

---

## 1. Prerequisites

| Item                 | Notes                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| AWS account / region | Same region pattern as UAT (e.g. `ap-southeast-7`)                                                      |
| EC2 instance         | Same bootstrap as UAT (`infra/ec2/bootstrap.sh`), preferably **Graviton** (arm64)                       |
| GitHub Environment   | Name must be exactly **`deploy/production`**                                                            |
| Branch               | Production deploys from **`deploy/production`** (or `workflow_dispatch` with that Environment selected) |
| UAT working          | Confirms OIDC, SSM agent, Caddy, and pull-only path before you mirror for prod                          |

Do **not** reuse UAT’s `EC2_INSTANCE_ID`, DB, Redis, R2 bucket, or Omise/live secrets on production.

**Do** set production `ECR_REPOSITORY` to the **exact same string as UAT** (shared image registry — promote the SHA tested in UAT).

---

## 2. GitHub Environment checklist (`deploy/production`)

Create **Settings → Environments → `deploy/production`**.

Recommended protection:

- Required reviewers (optional but advised)
- **Deployment branches**: allow `deploy/production` (and your default branch only if you intentionally dispatch from it)

### Secrets (required unless noted)

| Secret                                                           | Purpose                                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AWS_ROLE_ARN`                                                   | IAM role ARN for GitHub OIDC (ECR push + SSM)                                                       |
| `DB_PASSWORD`                                                    | Production Postgres                                                                                 |
| `CLOUDFLARE_ACCOUNT_ID`                                          | R2                                                                                                  |
| `CLOUDFLARE_ACCESS_KEY_ID`                                       | R2                                                                                                  |
| `CLOUDFLARE_SECRET_ACCESS_KEY`                                   | R2                                                                                                  |
| `CLOUDFLARE_R2_BUCKET`                                           | Production bucket name                                                                              |
| `JWT_SECRET`                                                     | Long random string (**different from UAT**)                                                         |
| `THAIBULKSMS_API_KEY` / `THAIBULKSMS_API_SECRET`                 | SMS                                                                                                 |
| `OMISE_PUBLIC_KEY` / `OMISE_SECRET_KEY` / `OMISE_WEBHOOK_SECRET` | **Live** Omise keys + webhook secret                                                                |
| `RESEND_API_KEY`                                                 | Email                                                                                               |
| `REDIS_PASSWORD`                                                 | Required when Redis auth is enabled (API fails boot in production if empty)                         |
| `BANK_DATA_ENCRYPTION_KEY`                                       | Long random secret for vendor bank account encryption at rest (generate: `openssl rand -base64 32`) |
| `OPENAI_API_KEY`                                                 | Optional (smart search / embeddings)                                                                |

### Variables (infrastructure)

| Variable                            | Production example  | Notes                                                                                                                                                                             |
| ----------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_REGION`                        | `ap-southeast-7`    | Must match ECR + EC2                                                                                                                                                              |
| `ECR_REPOSITORY`                    | _(same as UAT)_     | **Recommended:** exact same value as `deploy/uat` (e.g. both `sopet/backend-uat`, or both `sopet/backend`). A separate `sopet/backend-production` repo is optional, not required. |
| `EC2_INSTANCE_ID`                   | `i-0…`              | Production instance only                                                                                                                                                          |
| `DOCKER_PLATFORM`                   | `linux/arm64`       | **Set this for Graviton** → runner `ubuntu-24.04-arm`                                                                                                                             |
| `BUILD_ON_HOST`                     | _(leave unset)_     | Default OFF — GHA builds, EC2 pull-only                                                                                                                                           |
| `SSM_CLOUDWATCH_LOG_GROUP`          | `/sopet/ssm/deploy` | Optional live SSM logs                                                                                                                                                            |
| `CADDY_HOSTNAME`                    | `api.sopet.org`     | Public API host                                                                                                                                                                   |
| `CADDY_ADMIN_EMAIL`                 | ops email           | ACME / Caddy                                                                                                                                                                      |
| `CADDY_TLS_*` / `CADDY_TLS_ENABLED` | As per UAT pattern  | Often off if Cloudflare terminates TLS                                                                                                                                            |

### Variables (application — mirror UAT keys, production values)

Copy names from `infra/github-env.keys` / `infra/env.manifest.json`. Typical production values:

| Variable                                          | Example                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`                                        | `production`                                                     |
| `PORT`                                            | `3002`                                                           |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_NAME` | Production RDS                                                   |
| `DB_SSL`                                          | `true` (uses `infra/certs/rds-global-bundle.pem` for TLS verify) |
| `API_URL`                                         | `https://api.sopet.org`                                          |
| `STOREFRONT_URL` / `ADMIN_PANEL_URL`              | Production Vercel URLs                                           |
| `CORS_ORIGINS`                                    | Comma-separated production frontends                             |
| `CDN_URL`                                         | Production CDN / R2 public URL                                   |
| `STORAGE_PROVIDER`                                | `r2` (or `s3`)                                                   |

Full key list: **`infra/github-env.keys`**.

---

## 3. AWS checklist

### ECR (shared with UAT)

Prefer **one** repository for both Environments. If UAT already uses `sopet/backend-uat`, set production’s `ECR_REPOSITORY` to that same name — do **not** create a second repo unless you intentionally want isolated registries.

```bash
# Only if the shared repo does not exist yet (often already created for UAT):
aws ecr create-repository --repository-name sopet/backend-uat --region <AWS_REGION>
bash infra/apply-ecr-lifecycle-policy.sh sopet/backend-uat
# Or a neutral shared name: sopet/backend — then set BOTH Environments' ECR_REPOSITORY to that string.
```

Optional: a dedicated `sopet/backend-production` is fine if you want separate registries, but then production cannot reuse the UAT-built SHA without an extra copy/retag step (current workflow does not copy between repos).

### IAM — GitHub OIDC deploy role

- Trust GitHub Actions for this repo (and preferably only `deploy/production` / `deploy/uat` refs).
- Attach permissions from `infra/iam/github-deploy-ec2-policy.json` (ECR push/pull/describe, SSM Send/Get/Cancel).
- Put the role ARN in GitHub secret **`AWS_ROLE_ARN`** on `deploy/production`.
- With a **shared** ECR repo, this OIDC role must allow push/pull/describe on that same repository for both Environments (policy already scopes `sopet/*`).

### IAM — EC2 instance profile

- Attach `infra/iam/ec2-instance-ecr-policy.json` (ECR pull + SSM agent; includes CloudWatch logs if you use `SSM_CLOUDWATCH_LOG_GROUP`).
- **Both** UAT and production instance roles must be allowed to **pull** from the shared repository (`sopet/*` in the sample policy).

### Security group

- Inbound TCP **80** (and **443** if origin TLS) — Cloudflare IPs or `0.0.0.0/0`
- SSH optional if you use Session Manager only
- Outbound: all (ECR, RDS, Redis, Omise, etc.)

### Bootstrap host (once)

```bash
# On the production EC2 (SSH or SSM Session Manager), from a clone of this repo:
sudo AWS_REGION=<AWS_REGION> bash infra/ec2/bootstrap.sh
```

Confirm instance is **Online** in Systems Manager → Fleet Manager.

Runtime `.env` is **rendered by GitHub Actions** and written to `/opt/sopet/.env` on each deploy — you do not hand-maintain secrets on the host for normal deploys.

### DNS / Cloudflare

- A record for production API host → EC2 public IP (proxied)
- SSL/TLS mode **Full** (typical with HTTP origin on :80)
- Point Omise **live** webhook to `https://<API_URL>/webhooks/omise`

### First-time DB seed (once, after first successful migrate)

```bash
# Against production DB only, from a trusted machine with prod env:
yarn db:seed:prod
```

Creates `admin@sopet.org` — change password immediately. See [deployment.md](deployment.md#production-bootstrap).

---

## 4. Platform defaults (Graviton)

| Setting           | Production value              |
| ----------------- | ----------------------------- |
| `DOCKER_PLATFORM` | `linux/arm64`                 |
| `BUILD_ON_HOST`   | **unset** (do not set `true`) |

With that:

1. `resolve-runner` → `ubuntu-24.04-arm`
2. Image builds natively on GHA (aarch64), pushed to ECR
3. EC2 only **pulls** + restarts (SSM usually minutes, not 30+)

---

## 5. How to deploy (UAT first, then promote)

Images are tagged by **`github.sha`**. The workflow step **Check if image exists in ECR** skips build/push when that tag is already in `ECR_REPOSITORY`, then SSM pulls the same URI onto the target EC2.

### Step A — Deploy to UAT (builds & pushes)

1. Push/merge the release commit to **`deploy/uat`** (or `workflow_dispatch` with Environment `deploy/uat`).
2. Confirm UAT is healthy. Note the commit SHA that was deployed (Actions run → `github.sha`).

### Step B — Promote the same SHA to production

With **shared** `ECR_REPOSITORY`, production must run against the **same commit SHA** so `check-image` finds the existing tag and skips rebuild.

**Preferred (fast-forward so tip SHA matches UAT):**

```bash
git fetch origin
git checkout deploy/production
git merge --ff-only <uat-tested-sha>   # tip must equal the UAT-tested commit
git push origin deploy/production
```

This starts **Deploy** with Environment `deploy/production`. Logs should show `Reusing existing image <ECR_REPOSITORY>:<sha>` — no new build.

**Alternative: Actions UI → Run workflow**

1. Actions → **Deploy** → **Run workflow**
2. Choose a ref whose tip (or the commit you select) is the **exact UAT-tested SHA**
3. Set **environment** to **`deploy/production`**

If production’s `github.sha` differs (e.g. a merge commit), the workflow will **build and push a new image** to the shared repo — still valid, but you lose “promote the exact UAT artifact” unless that new SHA was also tested.

Prefer keeping `deploy/production` tip identical to the UAT-tested SHA when promoting.

---

## 6. What to watch in GitHub Actions logs

Healthy production (Graviton) run:

| Step / log signal      | Expected                                                            |
| ---------------------- | ------------------------------------------------------------------- |
| Job `resolve-runner`   | `DOCKER_PLATFORM=linux/arm64 → runs-on=ubuntu-24.04-arm`            |
| Job `deploy` runner    | Label `ubuntu-24.04-arm`                                            |
| Build step             | `Building image on GHA (aarch64) for platform: linux/arm64`         |
| No “build on EC2” note | Unless you set `BUILD_ON_HOST=true` (should not)                    |
| Deploy via SSM         | Pull-only; poll heartbeat; success in **minutes** (not 30–60+)      |
| Migrations             | `yarn migration:run` against **production** DB before image rollout |

If you see `ubuntu-latest` + arm64 platform, stop and fix `DOCKER_PLATFORM` / Environment wiring — cross-build is refused by design.

---

## 7. Post-deploy verify

```bash
# Public
curl -fsS "https://api.sopet.org/health"
curl -fsS "https://api.sopet.org/health/ready"

# GraphQL smoke
curl -fsS "https://api.sopet.org/graphql" \
  -H 'content-type: application/json' \
  --data '{"query":"{ __typename }"}'
```

On the instance (Session Manager):

```bash
docker ps --filter name=sopet-api
docker logs sopet-api --tail 100
systemctl status caddy   # or how Caddy was installed by setup-caddy.sh
curl -fsS http://127.0.0.1:3002/health
```

Also confirm storefront/admin GraphQL base URLs and Omise webhook delivery.

---

## 8. Rollback

`deploy.sh` prunes unused local images after a successful start, so rollback is **from ECR**, not from a leftover local tag.

Options:

1. **Re-deploy a known-good commit**  
   Reset/merge `deploy/production` to the good SHA and push (or `workflow_dispatch` that commit with Environment `deploy/production`).  
   Workflow reuses the existing ECR image tag (`github.sha`) if already present, then SSM pull + restart.

2. **Manual on EC2** (emergency):

```bash
export AWS_REGION=<region>
# Use the shared ECR repo name (same as GitHub var ECR_REPOSITORY), e.g. sopet/backend-uat:
export IMAGE_URI=<account>.dkr.ecr.<region>.amazonaws.com/<ECR_REPOSITORY>:<good-sha>
export ENV_FILE=/opt/sopet/.env
/opt/sopet/deploy.sh
```

**Note:** Migrations run forward on each deploy. Schema rollbacks need a separate migration strategy — do not assume container rollback undoes DDL.

---

## 9. UAT vs production (differences)

|                    | UAT                                            | Production                      |
| ------------------ | ---------------------------------------------- | ------------------------------- |
| GitHub Environment | `deploy/uat`                                   | `deploy/production`             |
| Branch trigger     | `deploy/uat`                                   | `deploy/production`             |
| ECR                | **Same `ECR_REPOSITORY` string** (recommended) | Same as UAT — promote by SHA    |
| EC2                | UAT instance id                                | Production instance id          |
| Domain             | e.g. `api-uat.sopet.org`                       | e.g. `api.sopet.org`            |
| `.env` on host     | `/opt/sopet/.env` (UAT values)                 | `/opt/sopet/.env` (prod values) |
| DB / Redis / R2    | UAT resources                                  | Production resources            |
| Omise              | test keys                                      | **live** keys                   |
| `DOCKER_PLATFORM`  | usually `linux/arm64`                          | same if Graviton                |
| `BUILD_ON_HOST`    | unset                                          | unset                           |

Structure (OIDC → ECR → SSM → Caddy → container :3002) is identical. Share the ECR repo; keep hosts, DB, and secrets environment-specific.

---

## Quick “must set in UI” before first prod click

1. GitHub Environment **`deploy/production`** with all secrets/vars from section 2
2. **`ECR_REPOSITORY`** = **exact same string as `deploy/uat`** (e.g. `sopet/backend-uat`)
3. **`DOCKER_PLATFORM=linux/arm64`** (Graviton); **`BUILD_ON_HOST` unset**
4. Shared ECR repo exists + lifecycle policy; OIDC + **both** EC2 instance profiles can pull (and OIDC can push) that repo
5. Cloudflare DNS + Omise live webhook
6. Deploy & verify **UAT** for the release SHA, then promote that **same SHA** to **`deploy/production`** (see section 5)

---

## 10. Target ops hardening (INF-014–017)

These items are **target architecture** for production hardening. They do not require application code changes; apply via AWS IAM, security groups, Cloudflare, and GitHub Environment design. Full checklists: workspace `docs/security/ops-hardening-runbook.md`.

| ID          | Topic                  | Target                                                                                                                                                                                                                        |
| ----------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **INF-014** | Migration runner       | Prefer TypeORM migrations from a **bastion / SSM session** (or OIDC → Secrets Manager short-lived creds + DDL-only DB user). Avoid long-lived production `DB_PASSWORD` on GitHub-hosted runners for migrate jobs.             |
| **INF-015** | Deploy IAM             | Narrow the GitHub OIDC deploy role: replace `Resource: "*"` for SSM/ECR (and related) with **specific ARNs** (ECR repo, instance IDs, secret ARNs). Keep UAT and production scoped separately where practical.                |
| **INF-016** | Security group port 80 | Do not leave instance (or unnecessary) TCP **80** open to `0.0.0.0/0`. Restrict to Cloudflare IP ranges, or ALB-only → private instance SG. Prefer closing 80 on the origin if Cloudflare/Caddy already terminate TLS on 443. |
| **INF-017** | Cloudflare TLS         | Use SSL/TLS mode **Full (Strict)** with a **valid origin certificate** (Cloudflare Origin CA or public CA) on Caddy/ALB — not "Full" alone.                                                                                   |

**Rollout:** UAT first → verify health/GraphQL/deploy → production. Track sign-off in the workspace ops runbook.
