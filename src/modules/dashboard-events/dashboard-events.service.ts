import { Injectable, Logger } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import {
  DASHBOARD_ACTIVITY,
  type DashboardActivityEvent,
  type DashboardActivityPayload,
  type DashboardActivityRole,
  DashboardActivityKind,
} from './dashboard-activity.constants';

export type PublishDashboardActivityInput = {
  kind: DashboardActivityKind;
  entityId: string;
  storeId?: string | null;
  userIds?: string[];
  roles?: DashboardActivityRole[];
};

@Injectable()
export class DashboardEventsService {
  private readonly logger = new Logger(DashboardEventsService.name);
  private readonly pubSub = new PubSub();

  dashboardActivityIterator() {
    return this.pubSub.asyncIterableIterator<DashboardActivityPayload>(DASHBOARD_ACTIVITY);
  }

  async publish(input: PublishDashboardActivityInput): Promise<void> {
    const event: DashboardActivityEvent = {
      kind: input.kind,
      entityId: input.entityId,
      storeId: input.storeId ?? null,
      userIds: input.userIds?.length ? [...new Set(input.userIds)] : undefined,
      roles: input.roles?.length ? [...new Set(input.roles)] : undefined,
    };

    try {
      await this.pubSub.publish(DASHBOARD_ACTIVITY, {
        dashboardActivity: event,
      } satisfies DashboardActivityPayload);
    } catch (error) {
      this.logger.warn(
        `dashboardActivity publish failed kind=${event.kind} entityId=${event.entityId}`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  static matchesRecipient(
    event: DashboardActivityEvent,
    userId: string | undefined,
    role: string | undefined,
  ): boolean {
    if (!userId || !role) {
      return false;
    }

    if (event.userIds?.includes(userId)) {
      return true;
    }

    if (event.roles?.includes(role as DashboardActivityRole)) {
      return true;
    }

    return false;
  }
}
