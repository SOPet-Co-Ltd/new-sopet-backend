import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { StoresService } from '../stores/stores.service';
import {
  AdminCustomerConnection,
  AdminCustomerDetailType,
  AdminCustomerType,
  VendorCustomerConnection,
  VendorCustomerDetailType,
  VendorCustomerType,
} from '../../graphql/models/types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateCustomerAsAdminInput } from './customers.inputs';
import { Customer } from '../../database/entities/customer.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';

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

@Resolver()
export class CustomersResolver {
  constructor(
    private readonly customersService: CustomersService,
    private readonly storesService: StoresService,
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

  @Mutation(() => AdminCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateCustomerAsAdmin(
    @Args('input') input: UpdateCustomerAsAdminInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
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
    });

    return mapAdminCustomer(customer);
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
    await this.storesService.assertStoreOwner(userId, storeId);
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
    await this.storesService.assertStoreOwner(userId, storeId);
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
    await this.storesService.assertStoreOwner(userId, storeId);
    const customer = await this.customersService.findByIdForVendor(storeId, id);
    const insights = await this.customersService.getInsightsForVendorStore(storeId, id);
    return {
      ...mapVendorCustomer(customer),
      insights,
    };
  }
}
