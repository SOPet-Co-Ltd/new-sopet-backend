import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleCampaign } from '../../database/entities/sale-campaign.entity';
import { SaleCampaignItem } from '../../database/entities/sale-campaign-item.entity';
import { SaleCampaignPricingService } from './sale-campaign-pricing.service';

@Module({
  imports: [TypeOrmModule.forFeature([SaleCampaign, SaleCampaignItem])],
  providers: [SaleCampaignPricingService],
  exports: [SaleCampaignPricingService],
})
export class SaleCampaignPricingModule {}
