import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { StoresService } from '../stores/stores.service';
import {
  AdminCustomerConnection,
  AdminCustomerType,
  VendorCustomerConnection,
  VendorCustomerType,
} from '../../graphql/models/types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateCustomerAsAdminInput } from './customers.inputs';
import { Customer } from '../../database/entities/customer.entity';

function mapAdminCustomer(customer: Customer): AdminCustomerType {
  return {
    id: customer.id,
    phone: customer.phone,
    fullName: customer.fullName,
    email: customer.email,
    dateOfBirth: customer.dateOfBirth,
    isVerified: customer.isVerified,
    isActive: customer.isActive,
    lastLoginAt: customer.lastLoginAt,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

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

@Resolver()
export class CustomersResolver {
  constructor(
    private readonly customersService: CustomersService,
    private readonly storesService: StoresService,
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

  @Mutation(() => AdminCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateCustomerAsAdmin(
    @Args('input') input: UpdateCustomerAsAdminInput,
  ): Promise<AdminCustomerType> {
    const customer = await this.customersService.updateAsAdmin(input);
    return mapAdminCustomer(customer);
  }

  @Mutation(() => AdminCustomerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setCustomerActive(
    @Args('id') id: string,
    @Args('isActive') isActive: boolean,
  ): Promise<AdminCustomerType> {
    const customer = await this.customersService.setActive(id, isActive);
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
}
