import { Resolver, Subscription } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardActivityType } from './dashboard-activity.types';
import type { DashboardActivityPayload } from './dashboard-activity.constants';
import { DashboardEventsService } from './dashboard-events.service';

@Resolver()
export class DashboardEventsResolver {
  constructor(private readonly dashboardEventsService: DashboardEventsService) {}

  @Subscription(() => DashboardActivityType, {
    filter: (
      payload: DashboardActivityPayload,
      _variables: unknown,
      context: { req?: { user?: { id?: string; role?: string } } },
    ) => {
      const user = context?.req?.user;
      return DashboardEventsService.matchesRecipient(
        payload.dashboardActivity,
        user?.id,
        user?.role,
      );
    },
    resolve: (payload: DashboardActivityPayload): DashboardActivityType => ({
      kind: payload.dashboardActivity.kind,
      entityId: payload.dashboardActivity.entityId,
      storeId: payload.dashboardActivity.storeId ?? null,
    }),
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'vendor')
  dashboardActivity() {
    return this.dashboardEventsService.dashboardActivityIterator();
  }
}
