import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD, APP_PIPE } from '@nestjs/core';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import omiseConfig from './config/omise.config';
import storageConfig from './config/storage.config';
import twilioConfig from './config/twilio.config';
import resendConfig from './config/resend.config';
import thaibulksmsConfig from './config/thaibulksms.config';
import redisConfig from './config/redis.config';
import searchConfig from './config/search.config';
import paymentConfig from './config/payment.config';

// Filters, Interceptors, Pipes
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ValidationPipe } from './common/pipes/validation.pipe';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { StoreStatusGuard } from './modules/auth/guards/store-status.guard';
import { CustomerStatusGuard } from './modules/auth/guards/customer-status.guard';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StoresModule } from './modules/stores/stores.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CartModule } from './modules/cart/cart.module';
import { AppGraphqlModule } from './graphql/graphql.module';
import { EmailModule } from './modules/email/email.module';
import { RedisModule } from './modules/redis/redis.module';
import { QueueModule } from './modules/queue/queue.module';
import { StorageModule } from './modules/storage/storage.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AdminTeamModule } from './modules/admin-team/admin-team.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { SearchModule } from './modules/search/search.module';
import { getPostgresSslOptions } from './database/postgres-ssl.util';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        jwtConfig,
        omiseConfig,
        storageConfig,
        twilioConfig,
        thaibulksmsConfig,
        resendConfig,
        redisConfig,
        searchConfig,
        paymentConfig,
      ],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: () => ({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'sopet_ecommerce',
        entities: [__dirname + '/database/entities/*.entity{.ts,.js}'],
        synchronize: false,
        migrations: ['dist/database/migrations/*.js'],
        migrationsRun: false,
        logging: process.env.NODE_ENV === 'development',
        ssl: getPostgresSslOptions(),
      }),
    }),

    // Feature Modules
    QueueModule.forRoot(),
    RedisModule,
    EmailModule,
    AuthModule,
    UsersModule,
    StoresModule,
    ProductsModule,
    OrdersModule,
    PaymentsModule,
    CartModule,
    StorageModule,
    PlatformModule,
    AdminTeamModule,
    PublicApiModule,
    SearchModule,
    AppGraphqlModule,
  ],
  providers: [
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global validation pipe
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
    // Global JWT guard
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global store-suspension guard (runs after JwtAuthGuard populates the user)
    {
      provide: APP_GUARD,
      useExisting: StoreStatusGuard,
    },
    // Global customer-suspension guard
    {
      provide: APP_GUARD,
      useExisting: CustomerStatusGuard,
    },
  ],
})
export class AppModule {}
