import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../../graphql/models/types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserNotification } from '../../database/entities/user-notification.entity';

@Resolver()
export class NotificationsResolver {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Query(() => [NotificationType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin', 'customer')
  async notifications(
    @CurrentUser('id') userId: string,
    @Args('unreadOnly', { nullable: true }) unreadOnly?: boolean,
  ): Promise<NotificationType[]> {
    const items = await this.notificationsService.findByUser(userId, unreadOnly);
    return items.map(mapNotification);
  }

  @Query(() => Int)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin', 'customer')
  async unreadNotificationsCount(@CurrentUser('id') userId: string): Promise<number> {
    return this.notificationsService.countUnread(userId);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin', 'customer')
  async markNotificationRead(
    @CurrentUser('id') userId: string,
    @Args('id') id: string,
  ): Promise<boolean> {
    return this.notificationsService.markAsRead(id, userId);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin', 'customer')
  async markAllNotificationsRead(@CurrentUser('id') userId: string): Promise<boolean> {
    return this.notificationsService.markAllAsRead(userId);
  }
}

function mapNotification(notification: UserNotification): NotificationType {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.subject ?? notification.message.split('\n')[0].slice(0, 100),
    message: notification.message,
    metadata: JSON.stringify(notification.metadata ?? {}),
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };
}
