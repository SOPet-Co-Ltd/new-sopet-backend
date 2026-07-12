import { config } from 'dotenv';
import { User, UserRole } from '../entities/user.entity';
import { PROD_ADMIN_EMAIL, SEED_PASSWORD } from './constants';
import { createDataSource, findOrCreateUser } from './helpers';

config();

function resolveProdAdminEmail(): string {
  return process.env.PROD_ADMIN_EMAIL?.trim() || PROD_ADMIN_EMAIL;
}

/**
 * Production bootstrap seed — creates the initial admin account only.
 * Safe to run multiple times: skips if the admin email already exists.
 * Does NOT create vendors, stores, products, promotions, or shipping data.
 */
export async function runProdSeed(): Promise<void> {
  const dataSource = await createDataSource();
  const adminEmail = resolveProdAdminEmail();

  try {
    const userRepo = dataSource.getRepository(User);

    const existing = await userRepo.findOne({ where: { email: adminEmail } });
    if (existing) {
      console.log(`Production admin already exists (${existing.email}) — nothing to do.`);
      return;
    }

    const { user, created } = await findOrCreateUser(userRepo, {
      email: adminEmail,
      password: SEED_PASSWORD,
      fullName: 'Admin SOPet',
      role: UserRole.ADMIN,
    });

    if (created) {
      console.log(`Created production admin (${user.email})`);
      console.log('Skipped vendor accounts, stores, and products.');
      console.log('\nIMPORTANT: Change the admin password after first login.');
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
