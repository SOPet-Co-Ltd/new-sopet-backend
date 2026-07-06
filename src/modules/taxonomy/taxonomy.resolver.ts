import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { CreateCategoryInput, CreateTagInput } from './taxonomy.inputs';
import { CategoryType, TagType } from '../../graphql/models/types';
import { mapCategory, mapTag } from '../../graphql/models/mappers';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Resolver()
export class TaxonomyResolver {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Query(() => [CategoryType])
  @Public()
  async approvedCategories(): Promise<CategoryType[]> {
    const categories = await this.taxonomyService.findApprovedCategories();
    return categories.map(mapCategory);
  }

  @Query(() => [TagType])
  @Public()
  async approvedTags(): Promise<TagType[]> {
    const tags = await this.taxonomyService.findApprovedTags();
    return tags.map(mapTag);
  }

  @Query(() => [CategoryType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingCategories(): Promise<CategoryType[]> {
    const categories = await this.taxonomyService.findPendingCategories();
    return categories.map(mapCategory);
  }

  @Query(() => [CategoryType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async myCategoryProposals(@CurrentUser('id') userId: string): Promise<CategoryType[]> {
    const categories = await this.taxonomyService.findCategoriesByCreator(userId);
    return categories.map(mapCategory);
  }

  @Query(() => [TagType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async myTagProposals(@CurrentUser('id') userId: string): Promise<TagType[]> {
    const tags = await this.taxonomyService.findTagsByCreator(userId);
    return tags.map(mapTag);
  }

  @Query(() => [TagType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingTags(): Promise<TagType[]> {
    const tags = await this.taxonomyService.findPendingTags();
    return tags.map(mapTag);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createCategory(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Args('input') input: CreateCategoryInput,
  ): Promise<CategoryType> {
    const category = await this.taxonomyService.createCategory(input.name, userId, role);
    return mapCategory(category);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createTag(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Args('input') input: CreateTagInput,
  ): Promise<TagType> {
    const tag = await this.taxonomyService.createTag(input.name, userId, role);
    return mapTag(tag);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveCategory(@Args('id') id: string): Promise<CategoryType> {
    const category = await this.taxonomyService.approveCategory(id);
    return mapCategory(category);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectCategory(@Args('id') id: string): Promise<CategoryType> {
    const category = await this.taxonomyService.rejectCategory(id);
    return mapCategory(category);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveTag(@Args('id') id: string): Promise<TagType> {
    const tag = await this.taxonomyService.approveTag(id);
    return mapTag(tag);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectTag(@Args('id') id: string): Promise<TagType> {
    const tag = await this.taxonomyService.rejectTag(id);
    return mapTag(tag);
  }
}
