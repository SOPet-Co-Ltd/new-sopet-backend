import { Repository } from 'typeorm';
import { Customer } from '../../database/entities/customer.entity';

export function getCustomerSoftDeleteRetentionHours(): number {
  const envValue = process.env.CUSTOMER_SOFT_DELETE_RETENTION_HOURS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return process.env.NODE_ENV === 'production' ? 360 : 24;
}

export function isDeletionRetentionExpired(deletionRequestedAt: Date): boolean {
  const retentionMs = getCustomerSoftDeleteRetentionHours() * 60 * 60 * 1000;
  return Date.now() > deletionRequestedAt.getTime() + retentionMs;
}

export function isPendingDeletion(customer: {
  isActive: boolean;
  deletionRequestedAt: Date | null;
}): boolean {
  return !customer.isActive && customer.deletionRequestedAt !== null;
}

export function isAdminSuspended(customer: {
  isActive: boolean;
  deletionRequestedAt: Date | null;
}): boolean {
  return !customer.isActive && customer.deletionRequestedAt === null;
}

export async function finalizeCustomerDeletion(
  customerRepository: Repository<Customer>,
  customerId: string,
): Promise<void> {
  await customerRepository.update(customerId, { fullName: null, email: null });
  await customerRepository.softDelete(customerId);
}
