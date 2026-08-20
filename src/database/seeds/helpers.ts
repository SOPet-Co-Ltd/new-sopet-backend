import * as bcrypt from 'bcrypt';
import { DataSource, DeepPartial, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import ormconfig from '../../../ormconfig';
import { User, UserRole } from '../entities/user.entity';
import { TaxonomyApprovalStatus } from '../entities/enums/taxonomy.enums';
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
    mustChangePassword?: boolean;
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
      mustChangePassword: input.mustChangePassword === true,
    }),
  );

  return { user, created: true };
}

type TaxonomySeedable = ObjectLiteral & {
  id: string;
  name: string;
  slug: string;
  approvalStatus: TaxonomyApprovalStatus;
  createdBy: string;
  imageUrl?: string | null;
};

/**
 * Idempotent taxonomy upsert by slug (falls back to case-insensitive name).
 * Ensures approved status for existing rows so re-running the seed keeps
 * catalog filters working on the storefront.
 */
export async function findOrCreateTaxonomyBySlug<T extends TaxonomySeedable>(
  repo: Repository<T>,
  input: {
    name: string;
    slug: string;
    createdBy: string;
    imageUrl?: string | null;
  },
): Promise<{ entity: T; created: boolean }> {
  const bySlug = { slug: input.slug } as FindOptionsWhere<T>;
  let existing = await repo.findOne({ where: bySlug });
  if (!existing) {
    existing = await repo
      .createQueryBuilder('t')
      .where('LOWER(t.name) = LOWER(:name)', { name: input.name })
      .getOne();
  }

  if (existing) {
    let dirty = false;
    if (existing.approvalStatus !== TaxonomyApprovalStatus.APPROVED) {
      existing.approvalStatus = TaxonomyApprovalStatus.APPROVED;
      dirty = true;
    }
    if (existing.slug !== input.slug) {
      // Prefer the seed slug when the name already exists under another slug.
      const slugTaken = await repo.findOne({ where: bySlug });
      if (!slugTaken) {
        existing.slug = input.slug;
        dirty = true;
      }
    }
    if (input.imageUrl && 'imageUrl' in existing && !existing.imageUrl) {
      existing.imageUrl = input.imageUrl;
      dirty = true;
    }
    if (dirty) {
      await repo.save(existing);
    }
    return { entity: existing, created: false };
  }

  const payload = {
    name: input.name,
    slug: input.slug,
    approvalStatus: TaxonomyApprovalStatus.APPROVED,
    createdBy: input.createdBy,
    ...(input.imageUrl != null ? { imageUrl: input.imageUrl } : {}),
  } as DeepPartial<T>;

  const entity = await repo.save(repo.create(payload));
  return { entity, created: true };
}
