import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformBanner } from '../../database/entities/platform-banner.entity';
import { PlatformSponsor } from '../../database/entities/platform-sponsor.entity';
import { PlatformAd } from '../../database/entities/platform-ad.entity';
import { Setting } from '../../database/entities/setting.entity';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { LoginPageImagesSettingsService } from './login-page-images-settings.service';
import { PlatformService } from './platform.service';
import { PlatformResolver } from './platform.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformBanner, PlatformSponsor, PlatformAd, Setting]),
    RedisModule,
    StorageModule,
  ],
  providers: [PlatformService, PlatformResolver, LoginPageImagesSettingsService],
  exports: [PlatformService, LoginPageImagesSettingsService],
})
export class PlatformModule {}
