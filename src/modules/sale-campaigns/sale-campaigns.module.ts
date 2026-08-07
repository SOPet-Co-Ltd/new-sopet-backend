import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleCampaign } from '../../database/entities/sale-campaign.entity';
import { SaleCampaignItem } from '../../database/entities/sale-campaign-item.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { SaleCampaignsService } from './sale-campaigns.service';
import { SaleCampaignsResolver } from './sale-campaigns.resolver';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SaleCampaign, SaleCampaignItem, Product, ProductVariant]),
    StoresModule,
  ],
  providers: [SaleCampaignsService, SaleCampaignsResolver],
  exports: [SaleCampaignsService],
})
export class SaleCampaignsModule {}
