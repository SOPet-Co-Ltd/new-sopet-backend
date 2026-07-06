import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import ormconfig from '../../../ormconfig';
import { User, UserRole } from '../entities/user.entity';
import { BCRYPT_ROUNDS } from './constants';

export async function hashSeedPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function createDataSource(): Promise<DataSource> {
  const dataSource = ormconfig;
  await dataSource.initialize();
  return dataSource;
}

export async function findOrCreateUser(
  userRepo: Repository<User>,
  input: {
    email: string;
    password: string;
    fullName: string;
    role: UserRole;
  },
): Promise<{ user: User; created: boolean }> {
  const existing = await userRepo.findOne({ where: { email: input.email } });
  if (existing) {
    return { user: existing, created: false };
  }

  const passwordHash = await hashSeedPassword(input.password);
  const user = await userRepo.save(
    userRepo.create({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      emailVerified: true,
      isActive: true,
    }),
  );

  return { user, created: true };
}
