import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UserRole } from '../../database/entities/user.entity';
import { TaxonomyService } from './taxonomy.service';
import {
  CreateCategoryInput,
  CreateTagInput,
  CreatePetTypeInput,
  CreateBrandInput,
  DeleteTaxonomyInput,
  SetCategoryImageInput,
  SetPetTypeImageInput,
  UpdateCategoryInput,
  UpdatePetTypeInput,
} from './taxonomy.inputs';
import {
  CategoryType,
  TagType,
  PetTypeType,
  BrandType,
  TaxonomyDeleteImpactType,
  DeleteTaxonomyResultType,
} from '../../graphql/models/types';
import { mapCategory, mapTag, mapPetType, mapBrand } from '../../graphql/models/mappers';
import { DeleteTaxonomyResult, TaxonomyDeleteImpact } from './taxonomy-delete.types';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Resolver()
export class TaxonomyResolver {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  private mapDeleteImpact(impact: TaxonomyDeleteImpact): TaxonomyDeleteImpactType {
    return impact;
  }

  private mapDeleteResult(result: DeleteTaxonomyResult): DeleteTaxonomyResultType {
    return result;
  }

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

  @Query(() => [CategoryType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectedCategories(): Promise<CategoryType[]> {
    const categories = await this.taxonomyService.findRejectedCategories();
    return categories.map(mapCategory);
  }

  @Query(() => [TagType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectedTags(): Promise<TagType[]> {
    const tags = await this.taxonomyService.findRejectedTags();
    return tags.map(mapTag);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createCategory(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Args('input') input: CreateCategoryInput,
  ): Promise<CategoryType> {
    const category = await this.taxonomyService.createCategory(
      input.name,
      userId,
      role,
      input.imageUrl,
    );
    return mapCategory(category);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateCategory(@Args('input') input: UpdateCategoryInput): Promise<CategoryType> {
    const category = await this.taxonomyService.updateCategory(input.categoryId, input.name);
    return mapCategory(category);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setCategoryImage(@Args('input') input: SetCategoryImageInput): Promise<CategoryType> {
    const category = await this.taxonomyService.setCategoryImage(input.categoryId, input.imageUrl);
    return mapCategory(category);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createTag(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
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

  @Query(() => [PetTypeType])
  @Public()
  async approvedPetTypes(): Promise<PetTypeType[]> {
    const petTypes = await this.taxonomyService.findApprovedPetTypes();
    return petTypes.map(mapPetType);
  }

  @Query(() => [BrandType])
  @Public()
  async approvedBrands(): Promise<BrandType[]> {
    const brands = await this.taxonomyService.findApprovedBrands();
    return brands.map(mapBrand);
  }

  @Query(() => [PetTypeType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingPetTypes(): Promise<PetTypeType[]> {
    const petTypes = await this.taxonomyService.findPendingPetTypes();
    return petTypes.map(mapPetType);
  }

  @Query(() => [BrandType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingBrands(): Promise<BrandType[]> {
    const brands = await this.taxonomyService.findPendingBrands();
    return brands.map(mapBrand);
  }

  @Query(() => [PetTypeType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async myPetTypeProposals(@CurrentUser('id') userId: string): Promise<PetTypeType[]> {
    const petTypes = await this.taxonomyService.findPetTypesByCreator(userId);
    return petTypes.map(mapPetType);
  }

  @Query(() => [BrandType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async myBrandProposals(@CurrentUser('id') userId: string): Promise<BrandType[]> {
    const brands = await this.taxonomyService.findBrandsByCreator(userId);
    return brands.map(mapBrand);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createPetType(
    @CurrentUser('id') userId: string,
    @Args('input') input: CreatePetTypeInput,
  ): Promise<PetTypeType> {
    const petType = await this.taxonomyService.createPetType(input.name, userId, input.imageUrl);
    return mapPetType(petType);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePetType(@Args('input') input: UpdatePetTypeInput): Promise<PetTypeType> {
    const petType = await this.taxonomyService.updatePetType(input.petTypeId, input.name);
    return mapPetType(petType);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setPetTypeImage(@Args('input') input: SetPetTypeImageInput): Promise<PetTypeType> {
    const petType = await this.taxonomyService.setPetTypeImage(input.petTypeId, input.imageUrl);
    return mapPetType(petType);
  }

  @Mutation(() => BrandType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createBrand(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Args('input') input: CreateBrandInput,
  ): Promise<BrandType> {
    const brand = await this.taxonomyService.createBrand(input.name, userId, role);
    return mapBrand(brand);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approvePetType(@Args('id') id: string): Promise<PetTypeType> {
    const petType = await this.taxonomyService.approvePetType(id);
    return mapPetType(petType);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectPetType(@Args('id') id: string): Promise<PetTypeType> {
    const petType = await this.taxonomyService.rejectPetType(id);
    return mapPetType(petType);
  }

  @Mutation(() => BrandType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveBrand(@Args('id') id: string): Promise<BrandType> {
    const brand = await this.taxonomyService.approveBrand(id);
    return mapBrand(brand);
  }

  @Mutation(() => BrandType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectBrand(@Args('id') id: string): Promise<BrandType> {
    const brand = await this.taxonomyService.rejectBrand(id);
    return mapBrand(brand);
  }

  @Query(() => TaxonomyDeleteImpactType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async categoryDeleteImpact(
    @Args('categoryId') categoryId: string,
  ): Promise<TaxonomyDeleteImpactType> {
    return this.mapDeleteImpact(await this.taxonomyService.getCategoryDeleteImpact(categoryId));
  }

  @Query(() => TaxonomyDeleteImpactType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async tagDeleteImpact(@Args('tagId') tagId: string): Promise<TaxonomyDeleteImpactType> {
    return this.mapDeleteImpact(await this.taxonomyService.getTagDeleteImpact(tagId));
  }

  @Query(() => TaxonomyDeleteImpactType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async petTypeDeleteImpact(
    @Args('petTypeId') petTypeId: string,
  ): Promise<TaxonomyDeleteImpactType> {
    return this.mapDeleteImpact(await this.taxonomyService.getPetTypeDeleteImpact(petTypeId));
  }

  @Query(() => TaxonomyDeleteImpactType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async brandDeleteImpact(@Args('brandId') brandId: string): Promise<TaxonomyDeleteImpactType> {
    return this.mapDeleteImpact(await this.taxonomyService.getBrandDeleteImpact(brandId));
  }

  @Mutation(() => DeleteTaxonomyResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteCategory(
    @Args('input') input: DeleteTaxonomyInput,
  ): Promise<DeleteTaxonomyResultType> {
    return this.mapDeleteResult(
      await this.taxonomyService.deleteCategory(input.id, input.replacementCategoryId),
    );
  }

  @Mutation(() => DeleteTaxonomyResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteTag(@Args('id') id: string): Promise<DeleteTaxonomyResultType> {
    return this.mapDeleteResult(await this.taxonomyService.deleteTag(id));
  }

  @Mutation(() => DeleteTaxonomyResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePetType(
    @Args('input') input: DeleteTaxonomyInput,
  ): Promise<DeleteTaxonomyResultType> {
    return this.mapDeleteResult(await this.taxonomyService.deletePetType(input.id));
  }

  @Mutation(() => DeleteTaxonomyResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteBrand(@Args('input') input: DeleteTaxonomyInput): Promise<DeleteTaxonomyResultType> {
    return this.mapDeleteResult(await this.taxonomyService.deleteBrand(input.id));
  }
}
