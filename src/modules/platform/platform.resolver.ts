import {
  Args,
  Context,
  Field,
  ID,
  InputType,
  Int,
  Mutation,
  Query,
  Resolver,
} from '@nestjs/graphql';
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
  BankTransferSettingsType,
  LoginPageImagesType,
  PlatformBannerType,
  PlatformSettingsType,
  PlatformSponsorType,
  PlatformAdType,
} from '../../graphql/models/types';
import { Public, Roles, CurrentUser } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformBanner } from '../../database/entities/platform-banner.entity';
import { PlatformSponsor } from '../../database/entities/platform-sponsor.entity';
import { PlatformAd } from '../../database/entities/platform-ad.entity';
import { LoginPageImagesSettingsService } from './login-page-images-settings.service';
import { UpdateLoginPageImagesInput } from './login-page-images.inputs';
import { BankTransferSettingsService } from './bank-transfer-settings.service';
import { UpdateBankTransferDetailsInput } from './bank-transfer.inputs';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { getAuditRequestContext } from '../audit-logs/audit-request-context';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

@InputType()
export class CreatePlatformBannerInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  title!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;

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
  id!: string;

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
  name!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;

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
  id!: string;

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
  title!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;

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
  id!: string;

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
  constructor(
    private readonly platformService: PlatformService,
    private readonly loginPageImagesSettingsService: LoginPageImagesSettingsService,
    private readonly bankTransferSettingsService: BankTransferSettingsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async logSettingsAudit(params: {
    adminId: string;
    adminEmail: string | undefined;
    action: string;
    resourceId: string | null;
    metadata?: Record<string, unknown>;
    req?: unknown;
  }): Promise<void> {
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: params.adminId,
      actorLabel: params.adminEmail ?? null,
      action: params.action,
      resourceType: AuditResourceType.SETTINGS,
      resourceId: params.resourceId,
      metadata: params.metadata,
      ...getAuditRequestContext(params.req),
    });
  }

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

  @Query(() => LoginPageImagesType)
  @Public()
  async loginPageImages(): Promise<LoginPageImagesType> {
    return mapLoginPageImages(await this.loginPageImagesSettingsService.get());
  }

  @Mutation(() => LoginPageImagesType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateLoginPageImages(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdateLoginPageImagesInput,
    @Context() context?: GraphqlContext,
  ): Promise<LoginPageImagesType> {
    const result = mapLoginPageImages(
      await this.loginPageImagesSettingsService.updateConfigured(input),
    );
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_LOGIN_PAGE_IMAGES_UPDATED,
      resourceId: null,
      metadata: { settingsKey: 'platform.login_page_images' },
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => LoginPageImagesType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async clearLoginPageDesktopImage(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Context() context?: GraphqlContext,
  ): Promise<LoginPageImagesType> {
    const result = mapLoginPageImages(await this.loginPageImagesSettingsService.clearDesktop());
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_LOGIN_PAGE_IMAGES_CLEARED_DESKTOP,
      resourceId: null,
      metadata: { settingsKey: 'platform.login_page_images' },
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => LoginPageImagesType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async clearLoginPageMobileImage(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Context() context?: GraphqlContext,
  ): Promise<LoginPageImagesType> {
    const result = mapLoginPageImages(await this.loginPageImagesSettingsService.clearMobile());
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_LOGIN_PAGE_IMAGES_CLEARED_MOBILE,
      resourceId: null,
      metadata: { settingsKey: 'platform.login_page_images' },
      req: context?.req,
    });
    return result;
  }

  @Query(() => BankTransferSettingsType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async bankTransferSettings(): Promise<BankTransferSettingsType> {
    return this.bankTransferSettingsService.get();
  }

  @Mutation(() => BankTransferSettingsType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateBankTransferDetails(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdateBankTransferDetailsInput,
    @Context() context?: GraphqlContext,
  ): Promise<BankTransferSettingsType> {
    const result = await this.bankTransferSettingsService.update(input);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_BANK_TRANSFER_UPDATED,
      resourceId: null,
      metadata: { settingsKey: 'payment.bank_transfer' },
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => PlatformBannerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPlatformBanner(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: CreatePlatformBannerInput,
    @Context() context?: GraphqlContext,
  ): Promise<PlatformBannerType> {
    const banner = await this.platformService.createBanner(input);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_BANNER_CREATED,
      resourceId: banner.id,
      req: context?.req,
    });
    return mapBanner(banner);
  }

  @Mutation(() => PlatformBannerType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePlatformBanner(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdatePlatformBannerInput,
    @Context() context?: GraphqlContext,
  ): Promise<PlatformBannerType> {
    const { id, ...data } = input;
    const banner = await this.platformService.updateBanner(id, data);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_BANNER_UPDATED,
      resourceId: banner.id,
      req: context?.req,
    });
    return mapBanner(banner);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePlatformBanner(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<boolean> {
    const result = await this.platformService.deleteBanner(id);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_BANNER_DELETED,
      resourceId: id,
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => [PlatformBannerType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async reorderPlatformBanners(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args({ name: 'ids', type: () => [ID] }) ids: string[],
    @Context() context?: GraphqlContext,
  ): Promise<PlatformBannerType[]> {
    const banners = await this.platformService.reorderBanners(ids);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_BANNER_REORDERED,
      resourceId: null,
      metadata: { ids },
      req: context?.req,
    });
    return banners.map(mapBanner);
  }

  @Mutation(() => PlatformSponsorType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPlatformSponsor(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: CreatePlatformSponsorInput,
    @Context() context?: GraphqlContext,
  ): Promise<PlatformSponsorType> {
    const sponsor = await this.platformService.createSponsor(input);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_SPONSOR_CREATED,
      resourceId: sponsor.id,
      req: context?.req,
    });
    return mapSponsor(sponsor);
  }

  @Mutation(() => PlatformSponsorType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePlatformSponsor(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdatePlatformSponsorInput,
    @Context() context?: GraphqlContext,
  ): Promise<PlatformSponsorType> {
    const { id, ...data } = input;
    const sponsor = await this.platformService.updateSponsor(id, data);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_SPONSOR_UPDATED,
      resourceId: sponsor.id,
      req: context?.req,
    });
    return mapSponsor(sponsor);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePlatformSponsor(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<boolean> {
    const result = await this.platformService.deleteSponsor(id);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_SPONSOR_DELETED,
      resourceId: id,
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => [PlatformSponsorType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async reorderPlatformSponsors(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args({ name: 'ids', type: () => [ID] }) ids: string[],
    @Context() context?: GraphqlContext,
  ): Promise<PlatformSponsorType[]> {
    const sponsors = await this.platformService.reorderSponsors(ids);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_SPONSOR_REORDERED,
      resourceId: null,
      metadata: { ids },
      req: context?.req,
    });
    return sponsors.map(mapSponsor);
  }

  @Mutation(() => PlatformAdType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPlatformAd(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: CreatePlatformAdInput,
    @Context() context?: GraphqlContext,
  ): Promise<PlatformAdType> {
    const ad = await this.platformService.createAd(input);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_AD_CREATED,
      resourceId: ad.id,
      req: context?.req,
    });
    return mapAd(ad);
  }

  @Mutation(() => PlatformAdType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePlatformAd(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdatePlatformAdInput,
    @Context() context?: GraphqlContext,
  ): Promise<PlatformAdType> {
    const { id, ...data } = input;
    const ad = await this.platformService.updateAd(id, data);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_AD_UPDATED,
      resourceId: ad.id,
      req: context?.req,
    });
    return mapAd(ad);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePlatformAd(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<boolean> {
    const result = await this.platformService.deleteAd(id);
    await this.logSettingsAudit({
      adminId,
      adminEmail,
      action: AuditAction.SETTINGS_AD_DELETED,
      resourceId: id,
      req: context?.req,
    });
    return result;
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

function mapLoginPageImages(value: {
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  altText: string | null;
}): LoginPageImagesType {
  return {
    desktopImageUrl: value.desktopImageUrl,
    mobileImageUrl: value.mobileImageUrl,
    altText: value.altText,
  };
}
