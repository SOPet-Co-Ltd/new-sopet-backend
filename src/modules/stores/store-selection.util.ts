import { Store, StoreStatus } from '../../database/entities/store.entity';

/** Prefer an approved, non-suspended store for the vendor JWT default. */
export function pickDefaultAccessibleStoreId(stores: Store[]): string | undefined {
  if (stores.length === 0) {
    return undefined;
  }

  const byRecency = [...stores].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const approved = byRecency.filter((store) => store.status === StoreStatus.APPROVED);
  if (approved.length > 0) {
    return approved[0].id;
  }

  const operative = byRecency.filter((store) => store.status !== StoreStatus.SUSPENDED);
  if (operative.length > 0) {
    return operative[0].id;
  }

  return byRecency[0].id;
}
