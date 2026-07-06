import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const schemaPath = join(projectRoot, 'src/schema.gql');
const schemaRelativePath = 'src/schema.gql';

try {
  await access(schemaPath, constants.F_OK);
  const { size } = await stat(schemaPath);
  console.log(`GraphQL schema found: ${schemaRelativePath} (${size} bytes)`);
} catch {
  console.error(`GraphQL schema not found at ${schemaRelativePath}`);
  console.error('Run `yarn start:dev` to generate it.');
  process.exit(1);
}
