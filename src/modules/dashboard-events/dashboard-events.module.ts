import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardEventsService } from './dashboard-events.service';
import { DashboardEventsResolver } from './dashboard-events.resolver';

@Module({
  imports: [AuthModule],
  providers: [DashboardEventsService, DashboardEventsResolver],
  exports: [DashboardEventsService],
})
export class DashboardEventsModule {}
