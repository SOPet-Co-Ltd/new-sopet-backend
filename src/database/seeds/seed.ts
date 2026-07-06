/**
 * @deprecated Use `yarn db:seed:dev` instead.
 */
import { runDevSeed } from './seed-dev';

runDevSeed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
