# Dependency security notes

Last reviewed with `yarn audit --level high` on the `feat/security-audit` branch.

## Resolutions (package.json)

| Package           | Resolution                               | Notes                                               |
| ----------------- | ---------------------------------------- | --------------------------------------------------- |
| `tar`             | `>=7.5.19`                               | Existing Critical fix via bcrypt/node-pre-gyp chain |
| `lodash`          | `>=4.18.0`                               | `@nestjs/config` transitive                         |
| `multer`          | `>=2.2.0`                                | `@nestjs/platform-express` transitive               |
| `ws`              | `>=8.21.0`                               | `@nestjs/graphql` transitive                        |
| `fast-uri`        | `>=3.1.5`                                | Transitive DoS advisory                             |
| `brace-expansion` | `2.1.4`                                  | Forces 2.x; yarn warns vs some `^1` / `^5` ranges   |
| `js-yaml`         | `4.3.1` (+ nested `3.15.1` for istanbul) | Jest/eslint loaders                                 |

## Status

- **High:** cleared via resolutions above (best-effort; re-run `yarn audit --level high` after dependency bumps).
- **Moderate:** residual advisories may remain; triage on next dep burn-down.
- **postcss:** no High advisory present in this audit snapshot (no resolution needed).

Do not remove resolutions without re-running audit and verifying Nest/Jest/TypeORM still build.
