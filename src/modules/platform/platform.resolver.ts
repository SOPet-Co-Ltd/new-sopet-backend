import { Args, Field, ID, InputType, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PlatformService } from './platform.service';
import {
  PlatformBannerType,
  PlatformSettingsType,
  PlatformSponsorType,
  PlatformAdType,
} from '../../graphql/models/types';
import { Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformBanner } from '../../database/entities/platform-banner.entity';
import { PlatformSponsor } from '../../database/entities/platform-sponsor.entity';
import { PlatformAd } from '../../database/entities/platform-ad.entity';

@InputType()
export class CreatePlatformBannerInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  title: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  mobileImageUrl?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  linkUrl?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endsAt?: Date | null;
}

@InputType()
export class UpdatePlatformBannerInput {
  @Field()
  @IsUUID()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  mobileImageUrl?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  linkUrl?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endsAt?: Date | null;
}

@InputType()
export class CreatePlatformSponsorInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  linkUrl?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endsAt?: Date | null;
}

@InputType()
export class UpdatePlatformSponsorInput {
  @Field()
  @IsUUID()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  linkUrl?: string | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endsAt?: Date | null;
}

@InputType()
export class CreatePlatformAdInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  title: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  linkUrl?: string | null;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endsAt?: Date | null;
}

@InputType()
export class UpdatePlatformAdInput {
  @Field()
  @IsUUID()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  linkUrl?: string | null;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  endsAt?: Date | null;
}

@Resolver()
export class PlatformResolver {
  constructor(private readonly platformService: PlatformService) {}

  @Query(() => [PlatformBannerType])
  @Public()
  async platformBanners(): Promise<PlatformBannerType[]> {
    const banners = await this.platformService.getActiveBanners();
    return banners.map(mapBanner);
  }

  @Query(() => [PlatformBannerType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async allPlatformBanners(): Promise<PlatformBannerType[]> {
    const banners = await this.platformService.getAllBanners();
    return banners.map(mapBanner);
  }

  @Query(() => [PlatformSponsorType])
  @Public()
  async platformSponsors(): Promise<PlatformSponsorType[]> {
    const sponsors = await this.platformService.getActiveSponsors();
    return sponsors.map(mapSponsor);
  }

  @Query(() => [PlatformSponsorType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async allPlatformSponsors(): Promise<PlatformSponsorType[]> {
    const sponsors = await this.platformService.getAllSponsors();
    return sponsors.map(mapSponsor);
  }

  @Query(() => [PlatformAdType])
  @Public()
  async platformAds(): Promise<PlatformAdType[]> {
    const ads = await this.platformService.getActiveAds();
    return ads.map(mapAd);
  }

  @Query(() => [PlatformAdType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async allPlatformAds(): Promise<PlatformAdType[]> {
    const ads = await this.platformService.getAllAds();
    return ads.map(mapAd);
  }

  @Query(() => PlatformSettingsType)
  @Public()
  platformSettings(): PlatformSettingsType {
    return this.platformService.getSettings();
  }

  @Mutation(() => PlatformBannerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPlatformBanner(
    @Args('input') input: CreatePlatformBannerInput,
  ): Promise<PlatformBannerType> {
    const banner = await this.platformService.createBanner(input);
    return mapBanner(banner);
  }

  @Mutation(() => PlatformBannerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePlatformBanner(
    @Args('input') input: UpdatePlatformBannerInput,
  ): Promise<PlatformBannerType> {
    const { id, ...data } = input;
    const banner = await this.platformService.updateBanner(id, data);
    return mapBanner(banner);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePlatformBanner(@Args('id') id: string): Promise<boolean> {
    return this.platformService.deleteBanner(id);
  }

  @Mutation(() => [PlatformBannerType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async reorderPlatformBanners(
    @Args({ name: 'ids', type: () => [ID] }) ids: string[],
  ): Promise<PlatformBannerType[]> {
    const banners = await this.platformService.reorderBanners(ids);
    return banners.map(mapBanner);
  }

  @Mutation(() => PlatformSponsorType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPlatformSponsor(
    @Args('input') input: CreatePlatformSponsorInput,
  ): Promise<PlatformSponsorType> {
    const sponsor = await this.platformService.createSponsor(input);
    return mapSponsor(sponsor);
  }

  @Mutation(() => PlatformSponsorType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePlatformSponsor(
    @Args('input') input: UpdatePlatformSponsorInput,
  ): Promise<PlatformSponsorType> {
    const { id, ...data } = input;
    const sponsor = await this.platformService.updateSponsor(id, data);
    return mapSponsor(sponsor);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePlatformSponsor(@Args('id') id: string): Promise<boolean> {
    return this.platformService.deleteSponsor(id);
  }

  @Mutation(() => [PlatformSponsorType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async reorderPlatformSponsors(
    @Args({ name: 'ids', type: () => [ID] }) ids: string[],
  ): Promise<PlatformSponsorType[]> {
    const sponsors = await this.platformService.reorderSponsors(ids);
    return sponsors.map(mapSponsor);
  }

  @Mutation(() => PlatformAdType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPlatformAd(@Args('input') input: CreatePlatformAdInput): Promise<PlatformAdType> {
    const ad = await this.platformService.createAd(input);
    return mapAd(ad);
  }

  @Mutation(() => PlatformAdType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePlatformAd(@Args('input') input: UpdatePlatformAdInput): Promise<PlatformAdType> {
    const { id, ...data } = input;
    const ad = await this.platformService.updateAd(id, data);
    return mapAd(ad);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePlatformAd(@Args('id') id: string): Promise<boolean> {
    return this.platformService.deleteAd(id);
  }
}

function mapBanner(banner: PlatformBanner): PlatformBannerType {
  return {
    id: banner.id,
    title: banner.title,
    imageUrl: banner.imageUrl,
    mobileImageUrl: banner.mobileImageUrl,
    linkUrl: banner.linkUrl,
    sortOrder: banner.sortOrder,
    isActive: banner.isActive,
    startsAt: banner.startsAt,
    endsAt: banner.endsAt,
  };
}

function mapSponsor(sponsor: PlatformSponsor): PlatformSponsorType {
  return {
    id: sponsor.id,
    name: sponsor.name,
    imageUrl: sponsor.imageUrl,
    linkUrl: sponsor.linkUrl,
    sortOrder: sponsor.sortOrder,
    isActive: sponsor.isActive,
    startsAt: sponsor.startsAt,
    endsAt: sponsor.endsAt,
  };
}

function mapAd(ad: PlatformAd): PlatformAdType {
  return {
    id: ad.id,
    title: ad.title,
    imageUrl: ad.imageUrl,
    linkUrl: ad.linkUrl,
    sortOrder: ad.sortOrder,
    isActive: ad.isActive,
    startsAt: ad.startsAt,
    endsAt: ad.endsAt,
  };
}
