import { Store, StoreStatus } from '../../database/entities/store.entity';
import { pickDefaultAccessibleStoreId } from './store-selection.util';

describe('pickDefaultAccessibleStoreId', () => {
  const now = new Date('2026-07-03T12:00:00Z');

  function store(id: string, status: StoreStatus, createdAt: Date): Store {
    return { id, status, createdAt } as Store;
  }

  it('prefers an approved store over a newer suspended store', () => {
    const stores = [
      store('suspended-new', StoreStatus.SUSPENDED, new Date('2026-07-02T20:00:00Z')),
      store('approved-old', StoreStatus.APPROVED, new Date('2026-07-02T15:00:00Z')),
    ];

    expect(pickDefaultAccessibleStoreId(stores)).toBe('approved-old');
  });

  it('prefers the newest approved store when multiple are approved', () => {
    const stores = [
      store('approved-old', StoreStatus.APPROVED, new Date('2026-07-01T12:00:00Z')),
      store('approved-new', StoreStatus.APPROVED, now),
    ];

    expect(pickDefaultAccessibleStoreId(stores)).toBe('approved-new');
  });

  it('falls back to a non-suspended store when none are approved', () => {
    const stores = [
      store('suspended', StoreStatus.SUSPENDED, now),
      store('pending', StoreStatus.PENDING, new Date('2026-07-01T12:00:00Z')),
    ];

    expect(pickDefaultAccessibleStoreId(stores)).toBe('pending');
  });
});
