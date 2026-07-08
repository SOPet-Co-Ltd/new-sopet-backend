import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { FavoritesService } from './favorites.service';
import {
  CustomerProfile,
  CustomerAuthPayload,
  FavoriteType,
  SavedAddressType,
  SavedPaymentMethodType,
} from '../../graphql/models/types';
import { mapProduct } from '../../graphql/models/mappers';
import { CurrentUser, Roles, Public } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateAddressInput,
  UpdateAddressInput,
  UpdateProfileInput,
  AddPaymentMethodInput,
  ChangeCustomerPhoneInput,
} from './account.inputs';
import { ReactivateAccountInput } from '../auth/auth.inputs';
import { Field, InputType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';

function mapPaymentMethod(method: SavedPaymentMethod): SavedPaymentMethodType {
  return {
    id: method.id,
    type: method.type,
    lastFour: method.lastFour,
    brand: method.brand,
    expiryMonth: method.expiryMonth,
    expiryYear: method.expiryYear,
    isDefault: method.isDefault,
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

@InputType()
export class FavoriteProductInput {
  @Field()
  @IsUUID()
  productId: string;
}

@Resolver()
export class AccountResolver {
  constructor(
    private readonly usersService: UsersService,
    private readonly favoritesService: FavoritesService,
  ) {}

  @Mutation(() => CustomerProfile)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async updateProfile(
    @CurrentUser('id') customerId: string,
    @Args('input') input: UpdateProfileInput,
  ): Promise<CustomerProfile> {
    const customer = await this.usersService.updateProfile(customerId, input);
    return {
      id: customer.id,
      phone: customer.phone,
      fullName: customer.fullName,
      email: customer.email,
    };
  }

  @Mutation(() => CustomerAuthPayload)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async changeCustomerPhone(
    @CurrentUser('id') customerId: string,
    @Args('input') input: ChangeCustomerPhoneInput,
  ): Promise<CustomerAuthPayload> {
    const result = await this.usersService.changeCustomerPhone(customerId, input.phone, input.code);

    return {
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      customer: {
        id: result.customer.id,
        phone: result.customer.phone,
        fullName: result.customer.fullName,
        email: result.customer.email,
      },
      pendingDeletion: false,
    };
  }

  @Query(() => [SavedAddressType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async addresses(@CurrentUser('id') customerId: string): Promise<SavedAddressType[]> {
    const addresses = await this.usersService.getAddresses(customerId);
    return addresses.map(mapAddress);
  }

  @Mutation(() => SavedAddressType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async createAddress(
    @CurrentUser('id') customerId: string,
    @Args('input') input: CreateAddressInput,
  ): Promise<SavedAddressType> {
    const address = await this.usersService.createAddress(customerId, {
      ...input,
      amphoe: input.amphoe ?? input.city ?? '',
      city: input.city,
    });
    return mapAddress(address);
  }

  @Mutation(() => SavedAddressType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async updateAddress(
    @CurrentUser('id') customerId: string,
    @Args('id') id: string,
    @Args('input') input: UpdateAddressInput,
  ): Promise<SavedAddressType> {
    const address = await this.usersService.updateAddress(customerId, id, {
      ...input,
      amphoe: input.amphoe ?? input.city,
    });
    return mapAddress(address);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async deleteAddress(
    @CurrentUser('id') customerId: string,
    @Args('id') id: string,
  ): Promise<boolean> {
    await this.usersService.deleteAddress(customerId, id);
    return true;
  }

  @Mutation(() => SavedAddressType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async setDefaultAddress(
    @CurrentUser('id') customerId: string,
    @Args('id') id: string,
  ): Promise<SavedAddressType> {
    const address = await this.usersService.setDefaultAddress(customerId, id);
    return mapAddress(address);
  }

  @Query(() => [FavoriteType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async favorites(@CurrentUser('id') customerId: string): Promise<FavoriteType[]> {
    const favorites = await this.favoritesService.list(customerId);
    return favorites.map((favorite) => ({
      id: favorite.id,
      productId: favorite.productId,
      product: favorite.product ? mapProduct(favorite.product) : null,
    }));
  }

  @Mutation(() => FavoriteType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async addFavorite(
    @CurrentUser('id') customerId: string,
    @Args('input') input: FavoriteProductInput,
  ): Promise<FavoriteType> {
    const favorite = await this.favoritesService.add(customerId, input.productId);
    return {
      id: favorite.id,
      productId: favorite.productId,
    };
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async removeFavorite(
    @CurrentUser('id') customerId: string,
    @Args('input') input: FavoriteProductInput,
  ): Promise<boolean> {
    return this.favoritesService.remove(customerId, input.productId);
  }

  @Query(() => [SavedPaymentMethodType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async paymentMethods(@CurrentUser('id') customerId: string): Promise<SavedPaymentMethodType[]> {
    const methods = await this.usersService.getPaymentMethods(customerId);
    return methods.map(mapPaymentMethod);
  }

  @Mutation(() => SavedPaymentMethodType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async addPaymentMethod(
    @CurrentUser('id') customerId: string,
    @Args('input') input: AddPaymentMethodInput,
  ): Promise<SavedPaymentMethodType> {
    const method = await this.usersService.addPaymentMethod(customerId, input);
    return mapPaymentMethod(method);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async deletePaymentMethod(
    @CurrentUser('id') customerId: string,
    @Args('id') id: string,
  ): Promise<boolean> {
    await this.usersService.deletePaymentMethod(customerId, id);
    return true;
  }

  @Mutation(() => SavedPaymentMethodType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async setDefaultPaymentMethod(
    @CurrentUser('id') customerId: string,
    @Args('id') id: string,
  ): Promise<SavedPaymentMethodType> {
    const method = await this.usersService.setDefaultPaymentMethod(customerId, id);
    return mapPaymentMethod(method);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async requestAccountDeletion(@CurrentUser('id') customerId: string): Promise<boolean> {
    await this.usersService.requestAccountDeletion(customerId);
    return true;
  }

  @Mutation(() => CustomerAuthPayload)
  @Public()
  async reactivateAccount(
    @Args('input') input: ReactivateAccountInput,
  ): Promise<CustomerAuthPayload> {
    const result = await this.usersService.reactivateAccount(input.reactivationToken);

    return {
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      customer: {
        id: result.customer.id,
        phone: result.customer.phone,
        fullName: result.customer.fullName,
        email: result.customer.email,
      },
      pendingDeletion: false,
    };
  }
}
