import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../database/entities/category.entity';
import { Tag } from '../../database/entities/tag.entity';
import { PetType } from '../../database/entities/pet-type.entity';
import { Brand } from '../../database/entities/brand.entity';
import { Product } from '../../database/entities/product.entity';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SearchModule } from '../search/search.module';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyResolver } from './taxonomy.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, Tag, PetType, Brand, Product]),
    StorageModule,
    NotificationsModule,
    SearchModule,
  ],
  providers: [TaxonomyService, TaxonomyResolver],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
