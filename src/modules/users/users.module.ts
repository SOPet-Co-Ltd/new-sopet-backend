import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { Customer } from '../../database/entities/customer.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { Favorite } from '../../database/entities/favorite.entity';
import { Product } from '../../database/entities/product.entity';
import { FavoritesService } from './favorites.service';
import { AccountResolver } from './account.resolver';
import { CustomerRepository } from '../../database/repositories/customer.repository';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Customer, SavedAddress, SavedPaymentMethod, Favorite, Product]),
  ],
  providers: [UsersService, FavoritesService, AccountResolver, CustomerRepository],
  exports: [UsersService, FavoritesService],
})
export class UsersModule {}
