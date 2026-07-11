import { Args, Field, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { StoresService } from './stores.service';
import { StoreTeamService } from './store-team.service';
import { ShippingOptionsService } from './shipping-options.service';
import { ShippingProvidersService } from './shipping-providers.service';
import { StoreRequestService } from './store-request.service';
import { StoreReactivationRequestService } from './store-reactivation-request.service';
import { VendorInvitationService } from './vendor-invitation.service';
import { AuthService } from '../auth/auth.service';
import {
  StoreType,
  VendorAuthPayload,
  UserProfile,
  StoreMemberType,
  StoreMemberInvitationType,
  StoreShippingOptionType,
  ShippingProviderType,
  VendorStoreType,
  MyStoreType,
  StoreRequestType,
  StoreReactivationRequestType,
  VendorInvitationType,
  AdminStoreType,
  AdminVendorType,
} from '../../graphql/models/types';
import {
  mapStore,
  mapStoreRequest,
  mapStoreReactivationRequest,
  mapAdminStore,
  mapStoreShippingOption,
  mapShippingProvider,
} from '../../graphql/models/mappers';
import { Public, CurrentUser, Roles, AllowSuspendedStore } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthRateLimitGuard } from '../auth/guards/auth-rate-limit.guard';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { RegisterStoreInput } from './register-store.input';
import {
  InviteStoreMemberInput,
  UpdateStoreMemberRoleInput,
  UpdateStoreSettingsInput,
  UpdateStorePayoutInput,
} from './store-team.inputs';
import { CreateShippingOptionInput, UpdateShippingOptionInput } from './shipping.inputs';
import {
  CreateShippingProviderInput,
  UpdateShippingProviderInput,
} from './shipping-provider.inputs';
import {
  RegisterVendorInput,
  SubmitStoreRequestInput,
  RejectStoreRequestInput,
  SubmitStoreReactivationRequestInput,
  RejectStoreReactivationRequestInput,
  InviteVendorInput,
  AcceptVendorInvitationInput,
  UpdateStoreAsAdminInput,
  CreateStoreAsAdminInput,
  UpdateVendorAsAdminInput,
} from './stores.inputs';
import { StoreMember } from '../../database/entities/store-member.entity';
import { StoreMemberInvitation } from '../../database/entities/store-member-invitation.entity';
import { StoreReactivationRequestStatus } from '../../database/entities/store-reactivation-request.entity';

@InputType()
export class ApproveStoreInput {
  @Field()
  @IsUUID()
  storeId: string;
}

@InputType()
export class RejectStoreInput {
  @Field()
  @IsUUID()
  storeId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

function mapStoreMember(member: StoreMember): StoreMemberType {
  return {
    id: member.id,
    storeId: member.storeId,
    userId: member.userId,
    role: member.role,
    email: member.user?.email ?? null,
    fullName: member.user?.fullName ?? null,
  };
}

function mapStoreMemberInvitation(invitation: StoreMemberInvitation): StoreMemberInvitationType {
  return {
    id: invitation.id,
    storeId: invitation.storeId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

function mapMyStore(store: Store, includePayout: boolean): MyStoreType {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description,
    logoUrl: store.logoUrl,
    bannerUrl: store.bannerUrl,
    contactPhone: store.contactPhone,
    contactEmail: store.contactEmail,
    address: store.address,
    bankAccountName: includePayout ? store.bankAccountName : null,
    bankAccountNumber: includePayout ? store.bankAccountNumber : null,
    bankName: includePayout ? store.bankName : null,
    bankCode: includePayout ? store.bankCode : null,
    omiseRecipientId: includePayout ? store.omiseRecipientId : null,
    omiseRecipientStatus: store.omiseRecipientStatus,
    omiseRecipientFailureMessage: includePayout ? store.omiseRecipientFailureMessage : null,
    status: store.status,
  };
}

@Resolver()
export class StoresResolver {
  constructor(
    private readonly storesService: StoresService,
    private readonly storeTeamService: StoreTeamService,
    private readonly shippingOptionsService: ShippingOptionsService,
    private readonly shippingProvidersService: ShippingProvidersService,
    private readonly storeRequestService: StoreRequestService,
    private readonly storeReactivationRequestService: StoreReactivationRequestService,
    private readonly vendorInvitationService: VendorInvitationService,
    private readonly authService: AuthService,
  ) {}

  @Query(() => [StoreType])
  @Public()
  async stores(): Promise<StoreType[]> {
    const stores = await this.storesService.findAll(StoreStatus.APPROVED);
    return stores.map(mapStore);
  }

  @Query(() => StoreType)
  @Public()
  async store(@Args('id') id: string): Promise<StoreType> {
    const store = await this.storesService.findOne(id);
    return mapStore(store);
  }

  @Query(() => StoreType)
  @Public()
  async storeBySlug(@Args('slug') slug: string): Promise<StoreType> {
    const store = await this.storesService.findBySlug(slug);
    return mapStore(store);
  }

  @Query(() => [VendorStoreType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @AllowSuspendedStore()
  async myStores(@CurrentUser('id') userId: string): Promise<VendorStoreType[]> {
    const accessible = await this.storesService.getAccessibleStores(userId);
    return accessible.map(({ store, membershipRole }) => ({
      store: mapStore(store),
      membershipRole,
    }));
  }

  @Query(() => [StoreType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingStores(): Promise<StoreType[]> {
    const stores = await this.storesService.getPendingStores();
    return stores.map(mapStore);
  }

  @Mutation(() => StoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveStore(
    @Args('input') input: ApproveStoreInput,
    @CurrentUser('id') adminId: string,
  ): Promise<StoreType> {
    const store = await this.storesService.approve(input.storeId, { adminId });
    return mapStore(store);
  }

  @Mutation(() => StoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectStore(
    @Args('input') input: RejectStoreInput,
    @CurrentUser('id') adminId: string,
  ): Promise<StoreType> {
    const store = await this.storesService.reject(input.storeId, {
      adminId,
      rejectionReason: input.rejectionReason,
    });
    return mapStore(store);
  }

  @Mutation(() => VendorAuthPayload)
  @Public()
  @UseGuards(AuthRateLimitGuard)
  async registerVendor(@Args('input') input: RegisterVendorInput): Promise<VendorAuthPayload> {
    await this.storesService.registerVendor({
      email: input.email,
      password: input.password,
      fullName: input.fullName,
    });

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
  async registerStore(@Args('input') input: RegisterStoreInput): Promise<VendorAuthPayload> {
    await this.storesService.registerVendor({
      email: input.ownerEmail,
      password: input.ownerPassword,
      fullName: input.ownerFullName,
    });

    const loginResult = await this.authService.login({
      email: input.ownerEmail,
      password: input.ownerPassword,
    });

    let address: string | undefined;
    if (input.address) {
      try {
        JSON.parse(input.address);
        address = input.address;
      } catch {
        address = input.address;
      }
    }

    await this.storeRequestService.submit(loginResult.user.id!, {
      storeName: input.name,
      description: input.description,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      address,
    });

    return {
      tokens: {
        accessToken: loginResult.accessToken,
        refreshToken: loginResult.refreshToken,
      },
      user: loginResult.user as UserProfile,
    };
  }

  @Mutation(() => StoreRequestType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @AllowSuspendedStore()
  async submitStoreRequest(
    @Args('input') input: SubmitStoreRequestInput,
    @CurrentUser('id') userId: string,
  ): Promise<StoreRequestType> {
    let address: string | undefined;
    if (input.address) {
      address = input.address;
    }

    const request = await this.storeRequestService.submit(userId, {
      storeName: input.storeName,
      description: input.description,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      address,
      logoUrl: input.logoUrl,
    });
    return mapStoreRequest(request);
  }

  @Query(() => [StoreRequestType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @AllowSuspendedStore()
  async myStoreRequests(@CurrentUser('id') userId: string): Promise<StoreRequestType[]> {
    const requests = await this.storeRequestService.findByVendor(userId);
    return requests.map(mapStoreRequest);
  }

  @Query(() => [StoreRequestType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingStoreRequests(): Promise<StoreRequestType[]> {
    const requests = await this.storeRequestService.findPending();
    return requests.map(mapStoreRequest);
  }

  @Mutation(() => StoreRequestType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveStoreRequest(
    @Args('id') id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<StoreRequestType> {
    const request = await this.storeRequestService.approve(id, adminId);
    return mapStoreRequest(request);
  }

  @Mutation(() => StoreRequestType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectStoreRequest(
    @Args('input') input: RejectStoreRequestInput,
    @CurrentUser('id') adminId: string,
  ): Promise<StoreRequestType> {
    const request = await this.storeRequestService.reject(input.id, adminId, input.reason);
    return mapStoreRequest(request);
  }

  @Mutation(() => VendorInvitationType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async inviteVendor(
    @Args('input') input: InviteVendorInput,
    @CurrentUser('id') adminId: string,
  ): Promise<VendorInvitationType> {
    const invitation = await this.vendorInvitationService.invite(input.email, adminId);
    return {
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      token: invitation.token,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  @Mutation(() => VendorAuthPayload)
  @Public()
  @UseGuards(AuthRateLimitGuard)
  async acceptVendorInvitation(
    @Args('input') input: AcceptVendorInvitationInput,
  ): Promise<VendorAuthPayload> {
    const user = await this.vendorInvitationService.accept(
      input.token,
      input.password,
      input.fullName,
    );

    const result = await this.authService.login({
      email: user.email,
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

  @Query(() => [VendorInvitationType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingVendorInvitations(): Promise<VendorInvitationType[]> {
    const invitations = await this.vendorInvitationService.findPending();
    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      token: invitation.token,
      expiresAt: invitation.expiresAt.toISOString(),
    }));
  }

  @Query(() => [AdminStoreType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminStores(): Promise<AdminStoreType[]> {
    const stores = await this.storesService.findAllForAdmin();
    return stores.map(mapAdminStore);
  }

  @Query(() => AdminStoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminStore(@Args('id') id: string): Promise<AdminStoreType> {
    const store = await this.storesService.findOne(id);
    return mapAdminStore(store);
  }

  @Mutation(() => AdminStoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateStoreAsAdmin(@Args('input') input: UpdateStoreAsAdminInput): Promise<AdminStoreType> {
    const store = await this.storesService.updateAsAdmin({
      id: input.id,
      name: input.name,
      slug: input.slug,
      ownerUserId: input.ownerId,
      description: input.description,
      logoUrl: input.logoUrl,
      bannerUrl: input.bannerUrl,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      address: input.address,
      status: input.status as StoreStatus | undefined,
    });
    return mapAdminStore(store);
  }

  @Mutation(() => AdminStoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createStoreAsAdmin(@Args('input') input: CreateStoreAsAdminInput): Promise<AdminStoreType> {
    const store = await this.storesService.createAsAdmin({
      ownerUserId: input.ownerUserId,
      name: input.name,
      description: input.description,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      address: input.address,
      logoUrl: input.logoUrl,
      bannerUrl: input.bannerUrl,
      status: StoreStatus.APPROVED,
    });
    return mapAdminStore(store);
  }

  @Query(() => [AdminVendorType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminVendors(
    @Args('search', { nullable: true }) search?: string,
  ): Promise<AdminVendorType[]> {
    const vendors = await this.storesService.findVendors(search);
    return vendors.map((vendor) => ({
      id: vendor.id,
      email: vendor.email,
      fullName: vendor.fullName,
      role: vendor.role,
      isActive: vendor.isActive,
      lastLoginAt: vendor.lastLoginAt,
      createdAt: vendor.createdAt,
      stores: (vendor.ownedStores ?? []).map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
      })),
    }));
  }

  @Query(() => AdminVendorType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminVendor(@Args('id') id: string): Promise<AdminVendorType> {
    const vendor = await this.storesService.findVendorById(id);
    return {
      id: vendor.id,
      email: vendor.email,
      fullName: vendor.fullName,
      role: vendor.role,
      isActive: vendor.isActive,
      lastLoginAt: vendor.lastLoginAt,
      createdAt: vendor.createdAt,
      stores: (vendor.ownedStores ?? []).map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
      })),
    };
  }

  @Mutation(() => AdminVendorType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateVendorAsAdmin(
    @Args('input') input: UpdateVendorAsAdminInput,
  ): Promise<AdminVendorType> {
    const vendor = await this.storesService.updateVendorAsAdmin({
      id: input.id,
      fullName: input.fullName,
      email: input.email,
      isActive: input.isActive,
    });
    const withStores = await this.storesService.findVendorById(vendor.id);
    return {
      id: withStores.id,
      email: withStores.email,
      fullName: withStores.fullName,
      role: withStores.role,
      isActive: withStores.isActive,
      lastLoginAt: withStores.lastLoginAt,
      createdAt: withStores.createdAt,
      stores: (withStores.ownedStores ?? []).map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
      })),
    };
  }

  @Query(() => [StoreShippingOptionType])
  @Public()
  async storeShippingOptions(@Args('storeId') storeId: string): Promise<StoreShippingOptionType[]> {
    const options = await this.shippingOptionsService.findByStore(storeId, true);
    return options.map(mapStoreShippingOption);
  }

  @Query(() => [ShippingProviderType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async shippingProviders(
    @Args('includeInactive', { nullable: true }) includeInactive?: boolean,
  ): Promise<ShippingProviderType[]> {
    const providers = await this.shippingProvidersService.findAll(includeInactive ?? false);
    return providers.map(mapShippingProvider);
  }

  @Query(() => [StoreShippingOptionType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async myStoreShippingOptions(
    @CurrentUser('storeId') storeId: string,
  ): Promise<StoreShippingOptionType[]> {
    const options = await this.shippingOptionsService.findByStore(storeId, false);
    return options.map(mapStoreShippingOption);
  }

  @Query(() => [StoreShippingOptionType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminStoreShippingOptions(
    @Args('storeId') storeId: string,
  ): Promise<StoreShippingOptionType[]> {
    const options = await this.shippingOptionsService.findByStoreForAdmin(storeId);
    return options.map(mapStoreShippingOption);
  }

  @Mutation(() => ShippingProviderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createShippingProvider(
    @Args('input') input: CreateShippingProviderInput,
  ): Promise<ShippingProviderType> {
    const provider = await this.shippingProvidersService.create(input);
    return mapShippingProvider(provider);
  }

  @Mutation(() => ShippingProviderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateShippingProvider(
    @Args('id') id: string,
    @Args('input') input: UpdateShippingProviderInput,
  ): Promise<ShippingProviderType> {
    const provider = await this.shippingProvidersService.update(id, input);
    return mapShippingProvider(provider);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteShippingProvider(@Args('id') id: string): Promise<boolean> {
    await this.shippingProvidersService.delete(id);
    return true;
  }

  @Mutation(() => StoreShippingOptionType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminCreateStoreShippingOption(
    @Args('storeId') storeId: string,
    @Args('input') input: CreateShippingOptionInput,
  ): Promise<StoreShippingOptionType> {
    const option = await this.shippingOptionsService.create(storeId, input);
    return mapStoreShippingOption(option);
  }

  @Mutation(() => StoreShippingOptionType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminUpdateStoreShippingOption(
    @Args('id') id: string,
    @Args('input') input: UpdateShippingOptionInput,
  ): Promise<StoreShippingOptionType> {
    const option = await this.shippingOptionsService.adminUpdate(id, input);
    return mapStoreShippingOption(option);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminDeleteStoreShippingOption(@Args('id') id: string): Promise<boolean> {
    await this.shippingOptionsService.adminDelete(id);
    return true;
  }

  @Query(() => [StoreMemberType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storeMembers(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<StoreMemberType[]> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const members = await this.storeTeamService.listMembers(storeId);
    return members.map(mapStoreMember);
  }

  @Query(() => [StoreMemberInvitationType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storeInvitations(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<StoreMemberInvitationType[]> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const invitations = await this.storeTeamService.listPendingInvitations(storeId);
    return invitations.map(mapStoreMemberInvitation);
  }

  @Query(() => MyStoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async myStore(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId?: string,
  ): Promise<MyStoreType> {
    if (!storeId) {
      throw new BadRequestException({
        code: 'NO_STORE_SELECTED',
        message: 'No store selected. Use switchStore first.',
      });
    }

    await this.storesService.assertStoreOwner(userId, storeId);
    const store = await this.storesService.findOne(storeId);
    const includePayout = await this.storesService.isStoreOwner(userId, storeId);
    return mapMyStore(store, includePayout);
  }

  @Mutation(() => StoreMemberInvitationType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async inviteStoreMember(
    @Args('input') input: InviteStoreMemberInput,
    @CurrentUser('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<StoreMemberInvitationType> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const invitation = await this.storeTeamService.inviteMember(
      storeId,
      userId,
      input.email,
      input.role,
    );
    return mapStoreMemberInvitation(invitation);
  }

  @Mutation(() => StoreMemberType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  @AllowSuspendedStore()
  async acceptStoreInvitation(
    @Args('token') token: string,
    @CurrentUser('id') userId: string,
  ): Promise<StoreMemberType> {
    const member = await this.storeTeamService.acceptInvitation(token, userId);
    return mapStoreMember(member);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async removeStoreMember(
    @Args('memberId') memberId: string,
    @CurrentUser('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<boolean> {
    await this.storesService.assertStoreOwner(userId, storeId);
    await this.storeTeamService.removeMember(storeId, memberId);
    return true;
  }

  @Mutation(() => StoreMemberType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateStoreMemberRole(
    @Args('input') input: UpdateStoreMemberRoleInput,
    @CurrentUser('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<StoreMemberType> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const member = await this.storeTeamService.updateMemberRole(
      storeId,
      input.memberId,
      input.role,
    );
    return mapStoreMember(member);
  }

  @Mutation(() => StoreMemberInvitationType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async revokeStoreInvitation(
    @Args('invitationId') invitationId: string,
    @CurrentUser('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<StoreMemberInvitationType> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const invitation = await this.storeTeamService.revokeInvitation(storeId, invitationId);
    return mapStoreMemberInvitation(invitation);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  @AllowSuspendedStore()
  async declineStoreInvitation(
    @Args('token') token: string,
    @CurrentUser('id') userId: string,
  ): Promise<boolean> {
    await this.storeTeamService.declineInvitation(token, userId);
    return true;
  }

  @Mutation(() => MyStoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateStore(
    @Args('input') input: UpdateStoreSettingsInput,
    @CurrentUser('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<MyStoreType> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const store = await this.storesService.updateStoreSettings(storeId, input);
    return mapMyStore(store, true);
  }

  @Mutation(() => MyStoreType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateStorePayout(
    @Args('input') input: UpdateStorePayoutInput,
    @CurrentUser('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<MyStoreType> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const store = await this.storesService.updateStorePayout(storeId, input);
    return mapMyStore(store, true);
  }

  @Mutation(() => StoreShippingOptionType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async createShippingOption(
    @Args('input') input: CreateShippingOptionInput,
    @CurrentUser('storeId') storeId: string,
  ): Promise<StoreShippingOptionType> {
    const option = await this.shippingOptionsService.create(storeId, input);
    return mapStoreShippingOption(option);
  }

  @Mutation(() => StoreShippingOptionType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateShippingOption(
    @Args('id') id: string,
    @Args('input') input: UpdateShippingOptionInput,
    @CurrentUser('storeId') storeId: string,
  ): Promise<StoreShippingOptionType> {
    const option = await this.shippingOptionsService.update(id, storeId, input);
    return mapStoreShippingOption(option);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async deleteShippingOption(
    @Args('id') id: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<boolean> {
    await this.shippingOptionsService.delete(id, storeId);
    return true;
  }

  @Mutation(() => StoreReactivationRequestType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @AllowSuspendedStore()
  async submitStoreReactivationRequest(
    @Args('input') input: SubmitStoreReactivationRequestInput,
    @CurrentUser('id') userId: string,
  ): Promise<StoreReactivationRequestType> {
    const request = await this.storeReactivationRequestService.submit(userId, {
      storeId: input.storeId,
      title: input.title,
      content: input.content,
      mediaUrls: input.mediaUrls,
    });
    return mapStoreReactivationRequest(request);
  }

  @Query(() => [StoreReactivationRequestType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @AllowSuspendedStore()
  async storeReactivationRequests(
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<StoreReactivationRequestType[]> {
    await this.storesService.assertStoreManager(userId, storeId);
    const requests = await this.storeReactivationRequestService.findByStore(storeId);
    return requests.map(mapStoreReactivationRequest);
  }

  @Query(() => [StoreReactivationRequestType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminStoreReactivationRequests(
    @Args('status', { nullable: true }) status?: string,
  ): Promise<StoreReactivationRequestType[]> {
    const resolvedStatus = status ? (status as StoreReactivationRequestStatus) : undefined;
    const requests = await this.storeReactivationRequestService.findForAdmin(resolvedStatus);
    return requests.map(mapStoreReactivationRequest);
  }

  @Mutation(() => StoreReactivationRequestType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveStoreReactivationRequest(
    @Args('id') id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<StoreReactivationRequestType> {
    const request = await this.storeReactivationRequestService.approve(id, adminId);
    return mapStoreReactivationRequest(request);
  }

  @Mutation(() => StoreReactivationRequestType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectStoreReactivationRequest(
    @Args('input') input: RejectStoreReactivationRequestInput,
    @CurrentUser('id') adminId: string,
  ): Promise<StoreReactivationRequestType> {
    const request = await this.storeReactivationRequestService.reject(
      input.id,
      adminId,
      input.reviewNote,
    );
    return mapStoreReactivationRequest(request);
  }
}
