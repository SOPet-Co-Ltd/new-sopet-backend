import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../database/entities/category.entity';
import { Tag } from '../../database/entities/tag.entity';
import { StorageModule } from '../storage/storage.module';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyResolver } from './taxonomy.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Tag]), StorageModule],
  providers: [TaxonomyService, TaxonomyResolver],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
