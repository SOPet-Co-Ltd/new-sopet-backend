# Backend Documentation

NestJS GraphQL API for the SOPET multi-vendor e-commerce platform.

## Index

| Document                                      | Description                                 |
| --------------------------------------------- | ------------------------------------------- |
| [Architecture](architecture.md)               | Module design, layers, dependency direction |
| [Folder structure](folder-structure.md)       | Every important directory explained         |
| [API (GraphQL)](api.md)                       | GraphQL setup, resolvers, REST endpoints    |
| [Database](database.md)                       | TypeORM, entities, migrations, seeds        |
| [Authentication](authentication.md)           | OTP, JWT, guards, decorators                |
| [Coding conventions](coding-conventions.md)   | Naming, validation, errors, testing         |
| [Feature development](feature-development.md) | End-to-end guide for new features           |
| [Deployment](deployment.md)                   | Docker, CI, production                      |
| [Troubleshooting](troubleshooting.md)         | Common issues                               |

## Cross-repo docs

- [Workspace developer docs](../../new-sopet-workspace/docs/developer/README.md)
- [Returns and disputes](../../new-sopet-workspace/docs/developer/returns-and-disputes.md)
- [System architecture](../../new-sopet-workspace/docs/developer/architecture.md)

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

| File                            | Purpose                                               |
| ------------------------------- | ----------------------------------------------------- |
| `src/main.ts`                   | Bootstrap, CORS, body parser (rawBody for Omise HMAC) |
| `src/app.module.ts`             | Root module, TypeORM, global guards/pipes/filters     |
| `src/graphql/graphql.module.ts` | Apollo Server, schema generation, DataLoaders         |
| `src/schema.gql`                | Auto-generated GraphQL schema (do not edit manually)  |
| `ormconfig.ts`                  | TypeORM CLI for migrations                            |
