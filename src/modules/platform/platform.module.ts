import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformBanner } from '../../database/entities/platform-banner.entity';
import { PlatformSponsor } from '../../database/entities/platform-sponsor.entity';
import { PlatformAd } from '../../database/entities/platform-ad.entity';
import { PlatformService } from './platform.service';
import { PlatformResolver } from './platform.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformBanner, PlatformSponsor, PlatformAd])],
  providers: [PlatformService, PlatformResolver],
  exports: [PlatformService],
})
export class PlatformModule {}
