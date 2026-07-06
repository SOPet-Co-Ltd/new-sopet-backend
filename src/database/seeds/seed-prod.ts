import { config } from 'dotenv';
import { User, UserRole } from '../entities/user.entity';
import { PROD_ADMIN_EMAIL, SEED_PASSWORD } from './constants';
import { createDataSource, findOrCreateUser } from './helpers';

config();

/**
 * Production bootstrap seed — creates the initial admin account only.
 * Safe to run multiple times: skips if admin@sopet.org already exists.
 * Does NOT drop data or create demo stores/products.
 */
export async function runProdSeed(): Promise<void> {
  const dataSource = await createDataSource();

  try {
    const userRepo = dataSource.getRepository(User);

    const { user, created } = await findOrCreateUser(userRepo, {
      email: PROD_ADMIN_EMAIL,
      password: SEED_PASSWORD,
      fullName: 'Admin SOPet',
      role: UserRole.ADMIN,
    });

    if (created) {
      console.log(`Created production admin (${PROD_ADMIN_EMAIL})`);
      console.log('\nIMPORTANT: Change the default password after first login.');
    } else {
      console.log(`Production admin already exists (${user.email}) — nothing to do.`);
    }
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  runProdSeed().catch((error) => {
    console.error('Production seed failed:', error);
    process.exit(1);
  });
}
