import { Global, Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderAuditLog } from '../../database/entities/order-audit-log.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { StoresModule } from '../stores/stores.module';
import { OrderAuditLogsService } from './order-audit-logs.service';
import { OrderAuditLogsResolver } from './order-audit-logs.resolver';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OrderAuditLog, OrderItem]), forwardRef(() => StoresModule)],
  providers: [OrderAuditLogsService, OrderAuditLogsResolver],
  exports: [OrderAuditLogsService],
})
export class OrderAuditLogsModule {}
