import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../database/entities/category.entity';
import { Tag } from '../../database/entities/tag.entity';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyResolver } from './taxonomy.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([Category, Tag])],
  providers: [TaxonomyService, TaxonomyResolver],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
