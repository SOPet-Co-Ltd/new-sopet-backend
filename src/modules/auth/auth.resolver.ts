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
  CustomerProfile,
  UserProfile,
  MessagePayload,
} from '../../graphql/models/types';
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
        customer: {
          id: result.customer.id,
          phone: result.customer.phone,
          fullName: result.customer.fullName,
          email: result.customer.email,
        },
      };
    }

    if (result.user) {
      return {
        user: {
          id: result.user.id,
          email: result.user.email,
          fullName: result.user.fullName,
          role: result.user.role,
          storeId: storeId ?? null,
        },
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
        customer: result.customer as CustomerProfile,
      };
    }

    return {
      tokens: {
        accessToken: result.accessToken!,
        refreshToken: result.refreshToken!,
      },
      customer: result.customer as CustomerProfile,
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
      user: result.user as UserProfile,
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
      user: result.user as UserProfile,
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
      user: {
        ...(result.user as UserProfile),
        storeId: input.storeId,
      },
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
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      storeId: storeId ?? null,
    };
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
  ): Promise<MessagePayload> {
    return this.authService.adminTriggerVendorPasswordReset(vendorId);
  }
}
