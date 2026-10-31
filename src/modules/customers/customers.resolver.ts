import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { StoresService } from '../stores/stores.service';
import { UsersService } from '../users/users.service';
import {
  AdminCustomerConnection,
  AdminCustomerDetailType,
  AdminCustomerType,
  SavedAddressType,
  VendorCustomerConnection,
  VendorCustomerDetailType,
  VendorCustomerType,
} from '../../graphql/models/types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateCustomerAsAdminInput } from './customers.inputs';
import { CreateAddressInput, UpdateAddressInput } from '../users/account.inputs';
import { Customer } from '../../database/entities/customer.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { getAuditRequestContext } from '../audit-logs/audit-request-context';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

function mapVendorCustomer(customer: Customer): VendorCustomerType {
  return {
    id: customer.id,
    phone: customer.phone,
    fullName: customer.fullName,
    email: customer.email,
    isVerified: customer.isVerified,
    lastLoginAt: customer.lastLoginAt,
    createdAt: customer.createdAt,
  };
}

function mapAdminCustomer(customer: Customer): AdminCustomerType {
  return {
    ...mapVendorCustomer(customer),
    dateOfBirth: customer.dateOfBirth,
    isActive: customer.isActive,
    updatedAt: customer.updatedAt,
  };
}

function mapAddress(address: SavedAddress): SavedAddressType {
  return {
    id: address.id,
    label: address.label,
    fullName: address.fullName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    tumbon: address.tumbon,
    amphoe: address.amphoe,
    province: address.province,
    postalCode: address.postalCode,
    isDefault: address.isDefault,
  };
}

@Resolver()
export class CustomersResolver {
  constructor(
    private readonly customersService: CustomersService,
    private readonly storesService: StoresService,
    private readonly usersService: UsersService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  @Query(() => AdminCustomerConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminCustomers(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('search', { nullable: true }) search?: string,
  ): Promise<AdminCustomerConnection> {
    const result = await this.customersService.findAllForAdmin(page, limit, search);
    return {
      items: result.items.map(mapAdminCustomer),
      pagination: result.pagination,
    };
  }

  @Query(() => AdminCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminCustomer(@Args('id') id: string): Promise<AdminCustomerType> {
    const customer = await this.customersService.findByIdForAdmin(id);
    return mapAdminCustomer(customer);
  }

  @Query(() => AdminCustomerDetailType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminCustomerDetail(@Args('id') id: string): Promise<AdminCustomerDetailType> {
    const customer = await this.customersService.findByIdForAdmin(id);
    const insights = await this.customersService.getInsightsForAdmin(id);
    return {
      ...mapAdminCustomer(customer),
      insights,
    };
  }

  @Query(() => [SavedAddressType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminCustomerAddresses(
    @Args('customerId') customerId: string,
  ): Promise<SavedAddressType[]> {
    await this.customersService.findByIdForAdmin(customerId);
    const addresses = await this.usersService.getAddresses(customerId);
    return addresses.map(mapAddress);
  }

  @Mutation(() => AdminCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateCustomerAsAdmin(
    @Args('input') input: UpdateCustomerAsAdminInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<AdminCustomerType> {
    const customer = await this.customersService.updateAsAdmin(input);

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.CUSTOMER_UPDATED,
      resourceType: AuditResourceType.CUSTOMER,
      resourceId: customer.id,
      metadata: {
        phone: input.phone,
        fullName: input.fullName,
        email: input.email,
      },
      ...getAuditRequestContext(context?.req),
    });

    return mapAdminCustomer(customer);
  }

  @Mutation(() => AdminCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setCustomerActive(
    @Args('id') id: string,
    @Args('isActive') isActive: boolean,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<AdminCustomerType> {
    const customer = await this.customersService.setActive(id, isActive);

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.CUSTOMER_STATUS_CHANGED,
      resourceType: AuditResourceType.CUSTOMER,
      resourceId: customer.id,
      metadata: { isActive },
      ...getAuditRequestContext(context?.req),
    });

    return mapAdminCustomer(customer);
  }

  @Mutation(() => AdminCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async verifyCustomerPhoneAsAdmin(
    @Args('id') id: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<AdminCustomerType> {
    const customer = await this.customersService.verifyPhoneAsAdmin(id);

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.EMAIL_VERIFIED,
      resourceType: AuditResourceType.CUSTOMER,
      resourceId: customer.id,
      metadata: { phone: customer.phone, method: 'admin_override' },
      ...getAuditRequestContext(context?.req),
    });

    return mapAdminCustomer(customer);
  }

  @Mutation(() => SavedAddressType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createCustomerAddressAsAdmin(
    @Args('customerId') customerId: string,
    @Args('input') input: CreateAddressInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<SavedAddressType> {
    await this.customersService.findByIdForAdmin(customerId);
    const address = await this.usersService.createAddress(customerId, {
      ...input,
      amphoe: input.amphoe ?? input.city ?? '',
      city: input.city,
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.CUSTOMER_ADDRESS_CREATED,
      resourceType: AuditResourceType.CUSTOMER_ADDRESS,
      resourceId: address.id,
      metadata: { customerId, operation: 'create' },
      ...getAuditRequestContext(context?.req),
    });

    return mapAddress(address);
  }

  @Mutation(() => SavedAddressType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateCustomerAddressAsAdmin(
    @Args('customerId') customerId: string,
    @Args('id') id: string,
    @Args('input') input: UpdateAddressInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<SavedAddressType> {
    await this.customersService.findByIdForAdmin(customerId);
    const address = await this.usersService.updateAddress(customerId, id, {
      ...input,
      amphoe: input.amphoe ?? input.city,
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.CUSTOMER_ADDRESS_UPDATED,
      resourceType: AuditResourceType.CUSTOMER_ADDRESS,
      resourceId: address.id,
      metadata: { customerId, operation: 'update' },
      ...getAuditRequestContext(context?.req),
    });

    return mapAddress(address);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteCustomerAddressAsAdmin(
    @Args('customerId') customerId: string,
    @Args('id') id: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<boolean> {
    await this.customersService.findByIdForAdmin(customerId);
    await this.usersService.deleteAddress(customerId, id);

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.CUSTOMER_ADDRESS_DELETED,
      resourceType: AuditResourceType.CUSTOMER_ADDRESS,
      resourceId: id,
      metadata: { customerId, operation: 'delete' },
      ...getAuditRequestContext(context?.req),
    });

    return true;
  }

  @Mutation(() => SavedAddressType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setCustomerDefaultAddressAsAdmin(
    @Args('customerId') customerId: string,
    @Args('id') id: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<SavedAddressType> {
    await this.customersService.findByIdForAdmin(customerId);
    const address = await this.usersService.setDefaultAddress(customerId, id);

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.CUSTOMER_ADDRESS_DEFAULT_SET,
      resourceType: AuditResourceType.CUSTOMER_ADDRESS,
      resourceId: address.id,
      metadata: { customerId, operation: 'set_default' },
      ...getAuditRequestContext(context?.req),
    });

    return mapAddress(address);
  }

  @Query(() => VendorCustomerConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async vendorCustomers(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('search', { nullable: true }) search?: string,
  ): Promise<VendorCustomerConnection> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const result = await this.customersService.findForVendorStore(storeId, page, limit, search);
    return {
      items: result.items.map(mapVendorCustomer),
      pagination: result.pagination,
    };
  }

  @Query(() => VendorCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async vendorCustomer(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
    @Args('id') id: string,
  ): Promise<VendorCustomerType> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const customer = await this.customersService.findByIdForVendor(storeId, id);
    return mapVendorCustomer(customer);
  }

  @Query(() => VendorCustomerDetailType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async vendorCustomerDetail(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
    @Args('id') id: string,
  ): Promise<VendorCustomerDetailType> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const customer = await this.customersService.findByIdForVendor(storeId, id);
    const insights = await this.customersService.getInsightsForVendorStore(storeId, id);
    return {
      ...mapVendorCustomer(customer),
      insights,
    };
  }
}
