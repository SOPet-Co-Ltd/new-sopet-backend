import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { SaleCampaignsService } from './sale-campaigns.service';
import {
  ActiveSaleCampaignItemType,
  SaleCampaignType,
} from '../../graphql/models/types';
import {
  mapActiveSaleCampaignItem,
  mapSaleCampaign,
} from '../../graphql/models/mappers';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { StoresService } from '../stores/stores.service';
import { CreateSaleCampaignInput, UpdateSaleCampaignInput } from './sale-campaigns.inputs';

@Resolver()
export class SaleCampaignsResolver {
  constructor(
    private readonly saleCampaignsService: SaleCampaignsService,
    private readonly storesService: StoresService,
  ) {}

  @Query(() => [SaleCampaignType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storeSaleCampaigns(
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SaleCampaignType[]> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const campaigns = await this.saleCampaignsService.findByStore(storeId);
    return campaigns.map(mapSaleCampaign);
  }

  @Query(() => SaleCampaignType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async saleCampaign(
    @Args('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<SaleCampaignType> {
    const campaign = await this.saleCampaignsService.findOne(id);
    await this.storesService.assertStoreAccess(userId, campaign.storeId);
    return mapSaleCampaign(campaign);
  }

  @Query(() => [ActiveSaleCampaignItemType])
  @Public()
  async activeSaleCampaignItems(
    @Args('storeId') storeId: string,
  ): Promise<ActiveSaleCampaignItemType[]> {
    const campaigns = await this.saleCampaignsService.findActiveForStore(storeId);
    return campaigns.flatMap((campaign) =>
      (campaign.items ?? []).map((item) => mapActiveSaleCampaignItem(item, campaign)),
    );
  }

  @Query(() => [ActiveSaleCampaignItemType])
  @Public()
  async activeSaleCampaignItemsForProducts(
    @Args('productIds', { type: () => [String] }) productIds: string[],
  ): Promise<ActiveSaleCampaignItemType[]> {
    const rows = await this.saleCampaignsService.findActiveItemsForProducts(productIds);
    return rows.map(({ item, campaign }) => mapActiveSaleCampaignItem(item, campaign));
  }

  @Mutation(() => SaleCampaignType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async createSaleCampaign(
    @Args('input') input: CreateSaleCampaignInput,
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') jwtStoreId?: string,
  ): Promise<SaleCampaignType> {
    const storeId = input.storeId ?? jwtStoreId;
    if (!storeId) {
      throw new BadRequestException({
        code: 'NO_STORE_SELECTED',
        message: 'Store ID required for sale campaigns',
      });
    }
    const campaign = await this.saleCampaignsService.create(userId, storeId, input);
    return mapSaleCampaign(campaign);
  }

  @Mutation(() => SaleCampaignType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateSaleCampaign(
    @Args('id') id: string,
    @Args('input') input: UpdateSaleCampaignInput,
    @CurrentUser('id') userId: string,
  ): Promise<SaleCampaignType> {
    const campaign = await this.saleCampaignsService.update(id, userId, input);
    return mapSaleCampaign(campaign);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async deleteSaleCampaign(
    @Args('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<boolean> {
    await this.saleCampaignsService.softDelete(id, userId);
    return true;
  }

  @Mutation(() => SaleCampaignType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async toggleSaleCampaign(
    @Args('id') id: string,
    @Args('isActive') isActive: boolean,
    @CurrentUser('id') userId: string,
  ): Promise<SaleCampaignType> {
    const campaign = await this.saleCampaignsService.toggle(id, userId, isActive);
    return mapSaleCampaign(campaign);
  }
}
