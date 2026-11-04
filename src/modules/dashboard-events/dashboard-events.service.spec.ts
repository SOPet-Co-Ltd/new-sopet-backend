import { DashboardActivityKind } from './dashboard-activity.constants';
import { DashboardEventsService } from './dashboard-events.service';

describe('DashboardEventsService', () => {
  let service: DashboardEventsService;

  beforeEach(() => {
    service = new DashboardEventsService();
  });

  describe('matchesRecipient', () => {
    it('delivers when userIds includes the subscriber', () => {
      expect(
        DashboardEventsService.matchesRecipient(
          {
            kind: DashboardActivityKind.ORDER,
            entityId: 'order-1',
            userIds: ['vendor-a', 'vendor-b'],
          },
          'vendor-a',
          'vendor',
        ),
      ).toBe(true);
    });

    it('does not deliver a store-owner event to another vendor', () => {
      expect(
        DashboardEventsService.matchesRecipient(
          {
            kind: DashboardActivityKind.ORDER,
            entityId: 'order-1',
            userIds: ['vendor-a'],
            roles: ['admin'],
          },
          'vendor-b',
          'vendor',
        ),
      ).toBe(false);
    });

    it('delivers to admin when roles includes admin', () => {
      expect(
        DashboardEventsService.matchesRecipient(
          {
            kind: DashboardActivityKind.ORDER,
            entityId: 'order-1',
            userIds: ['vendor-a'],
            roles: ['admin'],
          },
          'admin-1',
          'admin',
        ),
      ).toBe(true);
    });

    it('rejects missing user or role', () => {
      expect(
        DashboardEventsService.matchesRecipient(
          { kind: DashboardActivityKind.ORDER, entityId: 'order-1', roles: ['admin'] },
          undefined,
          'admin',
        ),
      ).toBe(false);
    });
  });

  describe('publish', () => {
    it('publishes events that the iterator receives', async () => {
      const iterator = service.dashboardActivityIterator();
      const nextPromise = iterator.next();

      await service.publish({
        kind: DashboardActivityKind.PAYOUT,
        entityId: 'payout-1',
        storeId: 'store-1',
        userIds: ['vendor-1'],
        roles: ['admin'],
      });

      const result = await nextPromise;
      expect(result.done).toBeFalsy();
      expect(result.value).toEqual({
        dashboardActivity: {
          kind: DashboardActivityKind.PAYOUT,
          entityId: 'payout-1',
          storeId: 'store-1',
          userIds: ['vendor-1'],
          roles: ['admin'],
        },
      });

      await iterator.return?.();
    });
  });
});
