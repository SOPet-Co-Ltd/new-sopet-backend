import { Module } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as repositories from './repositories';
import {
  User,
  Customer,
  OtpCode,
  Store,
  StoreMember,
  Product,
  ProductImage,
  ProductVariant,
  InventoryTransaction,
  Order,
  OrderItem,
  OrderStatusHistory,
  Promotion,
  PromotionUsage,
  Payout,
  PayoutItem,
  Review,
  ReviewImage,
  Dispute,
  DisputeMessage,
  SavedAddress,
  SavedPaymentMethod,
  Cart,
  CartItem,
  Notification,
  AdminLog,
  Setting,
  Payment,
  StoreRequest,
  VendorInvitation,
} from './entities';

const ENTITIES = [
  User,
  Customer,
  OtpCode,
  Store,
  StoreMember,
  Product,
  ProductImage,
  ProductVariant,
  InventoryTransaction,
  Order,
  OrderItem,
  OrderStatusHistory,
  Promotion,
  PromotionUsage,
  Payout,
  PayoutItem,
  Review,
  ReviewImage,
  Dispute,
  DisputeMessage,
  SavedAddress,
  SavedPaymentMethod,
  Cart,
  CartItem,
  Notification,
  AdminLog,
  Setting,
  Payment,
  StoreRequest,
  VendorInvitation,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => ({
        type: 'postgres' as const,
        host: configService.get<string>('DB_HOST'),
        port: Number(configService.get('DB_PORT')) || 5432,
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: ENTITIES,
        migrations: ['dist/database/migrations/*.js'],
        synchronize: false,
        logging: configService.get('NODE_ENV') === 'development',
        ssl:
          configService.get('DB_SSL') === 'true'
            ? {
                rejectUnauthorized: false,
              }
            : false,
        extra: {
          max: configService.get('DB_POOL_MAX') || 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 2000,
        },
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  providers: Object.values(repositories),
  exports: [TypeOrmModule, ...Object.values(repositories)],
})
export class DatabaseModule {}
