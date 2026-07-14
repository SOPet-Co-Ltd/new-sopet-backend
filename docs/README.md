# Backend Documentation

NestJS GraphQL API for the SOPET multi-vendor e-commerce platform.

## Index

| Document                                      | Description                                            |
| --------------------------------------------- | ------------------------------------------------------ |
| [Architecture](architecture.md)               | Module design, layers, dependency direction            |
| [Folder structure](folder-structure.md)       | Every important directory explained                    |
| [File types](file-types.md)                   | `.entity`, `.service`, `.resolver`, etc. — when to use |
| [API (GraphQL)](api.md)                       | GraphQL setup, resolvers, REST endpoints               |
| [Database](database.md)                       | TypeORM, entities, migrations, seeds                   |
| [Authentication](authentication.md)           | OTP, JWT, guards, decorators                           |
| [Coding conventions](coding-conventions.md)   | Naming, validation, errors, testing                    |
| [Feature development](feature-development.md) | End-to-end guide for new features                      |
| [Deployment](deployment.md)                   | Docker, CI, production                                 |
| [Troubleshooting](troubleshooting.md)         | Common issues                                          |

## Design notes

Planning / design docs (not day-to-day how-to) live under [`design/`](design/):

| Document                                                          | Description                             |
| ----------------------------------------------------------------- | --------------------------------------- |
| [Search & taxonomy fixes](design/search-taxonomy-fixes-design.md) | Backend design for search/taxonomy work |

## Related repos

- Storefront: sibling `../sopet-storefront` — runs `yarn graphql:codegen` against this repo’s `src/schema.gql`
- Admin: sibling `../sopet-admin` — same codegen flow
- See [Architecture](architecture.md) for this API’s module design

## Quick start

```bash
cp .env.example .env
yarn install
yarn docker:up
yarn migration:run
yarn db:seed:dev
yarn start:dev    # http://localhost:3002/graphql
```

## Key entry points

| File                            | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `src/main.ts`                   | Bootstrap, CORS, static `public/`, body parser (rawBody for Omise HMAC) |
| `src/app.module.ts`             | Root module, TypeORM, global guards/pipes/filters                       |
| `src/graphql/graphql.module.ts` | Apollo Server, schema generation, DataLoaders                           |
| `src/schema.gql`                | Auto-generated GraphQL schema (do not edit manually)                    |
| `public/images/email/`          | Brand assets for transactional emails (e.g. `sopet-logo-white.png`)     |
| `ormconfig.ts`                  | TypeORM CLI for migrations                                              |

## Email

Transactional mail: Resend via `modules/email/`. Logo URL is `${API_URL}/images/email/sopet-logo-white.png` (PNG for client compatibility). Local previews: `yarn email:previews` → `temp/email-previews/`. See [Authentication — email templates](authentication.md#email-templates).
