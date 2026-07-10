import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Customer } from '../../database/entities/customer.entity';
import { User } from '../../database/entities/user.entity';
import { OtpCode } from '../../database/entities/otp-code.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreMember } from '../../database/entities/store-member.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';
import { CartModule } from '../cart/cart.module';
import { GuestOrderLinkModule } from '../orders/guest-order-link.module';
import { RedisModule } from '../redis/redis.module';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { CustomerStatusGuard } from './guards/customer-status.guard';
import { StoreStatusGuard } from './guards/store-status.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, User, OtpCode, Store, StoreMember, PasswordResetToken]),
    EmailModule,
    SmsModule,
    CartModule,
    GuestOrderLinkModule,
    RedisModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessTokenExpiresIn'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    AuthRateLimitGuard,
    StoreStatusGuard,
    CustomerStatusGuard,
    AuthResolver,
    CustomerRepository,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    AuthRateLimitGuard,
    StoreStatusGuard,
    CustomerStatusGuard,
    JwtModule,
  ],
})
export class AuthModule {}
