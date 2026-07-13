import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public, CurrentUser, Roles, AllowSuspendedStore } from '../../common/decorators';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import {
  CustomerAuthPayload,
  VendorAuthPayload,
  AuthTokens,
  MeResult,
  MessagePayload,
  UserProfile,
} from '../../graphql/models/types';
import { mapCustomerProfile, mapUserProfile } from '../../graphql/models/mappers';
import { Customer } from '../../database/entities/customer.entity';
import { User } from '../../database/entities/user.entity';
import {
  RefreshTokenInput,
  SendCustomerOtpInput,
  VendorLoginInput,
  VerifyCustomerOtpInput,
  SwitchStoreInput,
  UpdateUserProfileInput,
  ChangePasswordInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from './auth.inputs';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Query(() => MeResult)
  @UseGuards(JwtAuthGuard)
  @AllowSuspendedStore()
  async me(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('storeId') storeId?: string,
  ): Promise<MeResult> {
    const result = await this.authService.getMe(userId, role);

    if (result.customer) {
      return {
        customer: mapCustomerProfile(result.customer),
      };
    }

    if (result.user) {
      return {
        user: mapUserProfile(result.user, storeId),
      };
    }

    return {};
  }

  @Mutation(() => MessagePayload)
  @Public()
  @UseGuards(AuthRateLimitGuard)
  async sendCustomerOtp(@Args('input') input: SendCustomerOtpInput): Promise<MessagePayload> {
    return this.authService.sendOtp({ phone: input.phone });
  }

  @Mutation(() => CustomerAuthPayload)
  @Public()
  async verifyCustomerOtp(
    @Args('input') input: VerifyCustomerOtpInput,
  ): Promise<CustomerAuthPayload> {
    const result = await this.authService.verifyOtp({
      phone: input.phone,
      code: input.code,
      sessionId: input.sessionId,
    });

    if (result.pendingDeletion) {
      return {
        pendingDeletion: true,
        reactivationToken: result.reactivationToken,
        customer: mapCustomerProfile(result.customer as Customer),
      };
    }

    return {
      tokens: {
        accessToken: result.accessToken!,
        refreshToken: result.refreshToken!,
      },
      customer: mapCustomerProfile(result.customer as Customer),
      pendingDeletion: false,
    };
  }

  @Mutation(() => VendorAuthPayload)
  @Public()
  @UseGuards(AuthRateLimitGuard)
  async vendorLogin(@Args('input') input: VendorLoginInput): Promise<VendorAuthPayload> {
    const result = await this.authService.login({
      email: input.email,
      password: input.password,
    });

    return {
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      user: mapUserProfile(result.user as User),
    };
  }

  @Mutation(() => VendorAuthPayload)
  @Public()
  @UseGuards(AuthRateLimitGuard)
  async adminLogin(@Args('input') input: VendorLoginInput): Promise<VendorAuthPayload> {
    const result = await this.authService.login({
      email: input.email,
      password: input.password,
    });

    return {
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      user: mapUserProfile(result.user as User),
    };
  }

  @Mutation(() => AuthTokens)
  @Public()
  async refreshToken(@Args('input') input: RefreshTokenInput): Promise<AuthTokens> {
    return this.authService.refreshToken(input.refreshToken);
  }

  @Mutation(() => VendorAuthPayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @AllowSuspendedStore()
  async switchStore(
    @CurrentUser('id') userId: string,
    @Args('input') input: SwitchStoreInput,
  ): Promise<VendorAuthPayload> {
    const result = await this.authService.switchStore(userId, input.storeId);

    return {
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      user: mapUserProfile(result.user as User, input.storeId),
    };
  }

  @Mutation(() => UserProfile)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  @AllowSuspendedStore()
  async updateUserProfile(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string | undefined,
    @Args('input') input: UpdateUserProfileInput,
  ): Promise<UserProfile> {
    const user = await this.authService.updateUserProfile(userId, input);
    return mapUserProfile(user, storeId);
  }

  @Mutation(() => MessagePayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  @AllowSuspendedStore()
  async changePassword(
    @CurrentUser('id') userId: string,
    @Args('input') input: ChangePasswordInput,
  ): Promise<MessagePayload> {
    await this.authService.changePassword(userId, input.currentPassword, input.newPassword);
    return { message: 'Password updated successfully' };
  }

  @Mutation(() => MessagePayload)
  @Public()
  @UseGuards(AuthRateLimitGuard)
  async requestPasswordReset(
    @Args('input') input: RequestPasswordResetInput,
  ): Promise<MessagePayload> {
    return this.authService.requestPasswordReset(input.email);
  }

  @Mutation(() => MessagePayload)
  @Public()
  async resetPassword(@Args('input') input: ResetPasswordInput): Promise<MessagePayload> {
    return this.authService.resetPassword(input.token, input.newPassword);
  }

  @Mutation(() => MessagePayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminTriggerVendorPasswordReset(
    @Args('vendorId') vendorId: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
  ): Promise<MessagePayload> {
    return this.authService.adminTriggerVendorPasswordReset(vendorId, {
      id: adminId,
      fullName: adminEmail,
    });
  }

  @Mutation(() => MessagePayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminResendVendorEmailVerification(
    @Args('vendorId') vendorId: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
  ): Promise<MessagePayload> {
    return this.authService.adminResendVendorEmailVerification(vendorId, {
      id: adminId,
      fullName: adminEmail,
    });
  }

  @Mutation(() => MessagePayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminVerifyVendorEmail(
    @Args('vendorId') vendorId: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
  ): Promise<MessagePayload> {
    return this.authService.adminVerifyVendorEmail(vendorId, {
      id: adminId,
      fullName: adminEmail,
    });
  }

  @Mutation(() => MessagePayload)
  @Public()
  async verifyEmail(@Args('input') input: VerifyEmailInput): Promise<MessagePayload> {
    return this.authService.verifyEmail(input.token);
  }

  @Mutation(() => MessagePayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @AllowSuspendedStore()
  async resendEmailVerification(@CurrentUser('id') userId: string): Promise<MessagePayload> {
    return this.authService.resendEmailVerification(userId);
  }
}
