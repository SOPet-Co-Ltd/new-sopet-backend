import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
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
  UpdateTagInput,
  UpdateBrandInput,
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
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { getAuditRequestContext } from '../audit-logs/audit-request-context';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

@Resolver()
export class TaxonomyResolver {
  constructor(
    private readonly taxonomyService: TaxonomyService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private mapDeleteImpact(impact: TaxonomyDeleteImpact): TaxonomyDeleteImpactType {
    return impact;
  }

  private mapDeleteResult(result: DeleteTaxonomyResult): DeleteTaxonomyResultType {
    return result;
  }

  private isAdminRole(role: UserRole | string): boolean {
    return String(role) === 'admin';
  }

  private async logTaxonomyAudit(params: {
    adminId: string;
    adminEmail: string | undefined;
    action: string;
    resourceId: string;
    kind: 'category' | 'tag' | 'pet_type' | 'brand';
    req?: unknown;
  }): Promise<void> {
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: params.adminId,
      actorLabel: params.adminEmail ?? null,
      action: params.action,
      resourceType: AuditResourceType.TAXONOMY,
      resourceId: params.resourceId,
      metadata: { kind: params.kind },
      ...getAuditRequestContext(params.req),
    });
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

  @Query(() => [PetTypeType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectedPetTypes(): Promise<PetTypeType[]> {
    const petTypes = await this.taxonomyService.findRejectedPetTypes();
    return petTypes.map(mapPetType);
  }

  @Query(() => [BrandType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectedBrands(): Promise<BrandType[]> {
    const brands = await this.taxonomyService.findRejectedBrands();
    return brands.map(mapBrand);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createCategory(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @CurrentUser('email') email: string | undefined,
    @Args('input') input: CreateCategoryInput,
    @Context() context?: GraphqlContext,
  ): Promise<CategoryType> {
    const category = await this.taxonomyService.createCategory(
      input.name,
      userId,
      role,
      input.imageUrl,
    );
    if (this.isAdminRole(role)) {
      await this.logTaxonomyAudit({
        adminId: userId,
        adminEmail: email,
        action: AuditAction.TAXONOMY_CATEGORY_CREATED,
        resourceId: category.id,
        kind: 'category',
        req: context?.req,
      });
    }
    return mapCategory(category);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateCategory(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdateCategoryInput,
    @Context() context?: GraphqlContext,
  ): Promise<CategoryType> {
    const category = await this.taxonomyService.updateCategory(
      input.categoryId,
      input.name,
      input.slug,
    );
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_CATEGORY_UPDATED,
      resourceId: category.id,
      kind: 'category',
      req: context?.req,
    });
    return mapCategory(category);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setCategoryImage(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: SetCategoryImageInput,
    @Context() context?: GraphqlContext,
  ): Promise<CategoryType> {
    const category = await this.taxonomyService.setCategoryImage(input.categoryId, input.imageUrl);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_CATEGORY_IMAGE_SET,
      resourceId: category.id,
      kind: 'category',
      req: context?.req,
    });
    return mapCategory(category);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createTag(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @CurrentUser('email') email: string | undefined,
    @Args('input') input: CreateTagInput,
    @Context() context?: GraphqlContext,
  ): Promise<TagType> {
    const tag = await this.taxonomyService.createTag(input.name, userId, role);
    if (this.isAdminRole(role)) {
      await this.logTaxonomyAudit({
        adminId: userId,
        adminEmail: email,
        action: AuditAction.TAXONOMY_TAG_CREATED,
        resourceId: tag.id,
        kind: 'tag',
        req: context?.req,
      });
    }
    return mapTag(tag);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateTag(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdateTagInput,
    @Context() context?: GraphqlContext,
  ): Promise<TagType> {
    const tag = await this.taxonomyService.updateTag(input.tagId, input.name, input.slug);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_TAG_UPDATED,
      resourceId: tag.id,
      kind: 'tag',
      req: context?.req,
    });
    return mapTag(tag);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveCategory(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<CategoryType> {
    const category = await this.taxonomyService.approveCategory(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_CATEGORY_APPROVED,
      resourceId: category.id,
      kind: 'category',
      req: context?.req,
    });
    return mapCategory(category);
  }

  @Mutation(() => CategoryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectCategory(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<CategoryType> {
    const category = await this.taxonomyService.rejectCategory(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_CATEGORY_REJECTED,
      resourceId: category.id,
      kind: 'category',
      req: context?.req,
    });
    return mapCategory(category);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveTag(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<TagType> {
    const tag = await this.taxonomyService.approveTag(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_TAG_APPROVED,
      resourceId: tag.id,
      kind: 'tag',
      req: context?.req,
    });
    return mapTag(tag);
  }

  @Mutation(() => TagType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectTag(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<TagType> {
    const tag = await this.taxonomyService.rejectTag(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_TAG_REJECTED,
      resourceId: tag.id,
      kind: 'tag',
      req: context?.req,
    });
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
    @CurrentUser('role') role: UserRole,
    @CurrentUser('email') email: string | undefined,
    @Args('input') input: CreatePetTypeInput,
    @Context() context?: GraphqlContext,
  ): Promise<PetTypeType> {
    const petType = await this.taxonomyService.createPetType(
      input.name,
      userId,
      role,
      input.imageUrl,
    );
    if (this.isAdminRole(role)) {
      await this.logTaxonomyAudit({
        adminId: userId,
        adminEmail: email,
        action: AuditAction.TAXONOMY_PET_TYPE_CREATED,
        resourceId: petType.id,
        kind: 'pet_type',
        req: context?.req,
      });
    }
    return mapPetType(petType);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updatePetType(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdatePetTypeInput,
    @Context() context?: GraphqlContext,
  ): Promise<PetTypeType> {
    const petType = await this.taxonomyService.updatePetType(
      input.petTypeId,
      input.name,
      input.slug,
    );
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_PET_TYPE_UPDATED,
      resourceId: petType.id,
      kind: 'pet_type',
      req: context?.req,
    });
    return mapPetType(petType);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setPetTypeImage(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: SetPetTypeImageInput,
    @Context() context?: GraphqlContext,
  ): Promise<PetTypeType> {
    const petType = await this.taxonomyService.setPetTypeImage(input.petTypeId, input.imageUrl);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_PET_TYPE_IMAGE_SET,
      resourceId: petType.id,
      kind: 'pet_type',
      req: context?.req,
    });
    return mapPetType(petType);
  }

  @Mutation(() => BrandType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async createBrand(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('email') email: string | undefined,
    @Args('input') input: CreateBrandInput,
    @Context() context?: GraphqlContext,
  ): Promise<BrandType> {
    const brand = await this.taxonomyService.createBrand(input.name, userId, role);
    if (this.isAdminRole(role)) {
      await this.logTaxonomyAudit({
        adminId: userId,
        adminEmail: email,
        action: AuditAction.TAXONOMY_BRAND_CREATED,
        resourceId: brand.id,
        kind: 'brand',
        req: context?.req,
      });
    }
    return mapBrand(brand);
  }

  @Mutation(() => BrandType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateBrand(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: UpdateBrandInput,
    @Context() context?: GraphqlContext,
  ): Promise<BrandType> {
    const brand = await this.taxonomyService.updateBrand(input.brandId, input.name, input.slug);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_BRAND_UPDATED,
      resourceId: brand.id,
      kind: 'brand',
      req: context?.req,
    });
    return mapBrand(brand);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approvePetType(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<PetTypeType> {
    const petType = await this.taxonomyService.approvePetType(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_PET_TYPE_APPROVED,
      resourceId: petType.id,
      kind: 'pet_type',
      req: context?.req,
    });
    return mapPetType(petType);
  }

  @Mutation(() => PetTypeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectPetType(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<PetTypeType> {
    const petType = await this.taxonomyService.rejectPetType(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_PET_TYPE_REJECTED,
      resourceId: petType.id,
      kind: 'pet_type',
      req: context?.req,
    });
    return mapPetType(petType);
  }

  @Mutation(() => BrandType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async approveBrand(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<BrandType> {
    const brand = await this.taxonomyService.approveBrand(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_BRAND_APPROVED,
      resourceId: brand.id,
      kind: 'brand',
      req: context?.req,
    });
    return mapBrand(brand);
  }

  @Mutation(() => BrandType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectBrand(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<BrandType> {
    const brand = await this.taxonomyService.rejectBrand(id);
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_BRAND_REJECTED,
      resourceId: brand.id,
      kind: 'brand',
      req: context?.req,
    });
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
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: DeleteTaxonomyInput,
    @Context() context?: GraphqlContext,
  ): Promise<DeleteTaxonomyResultType> {
    const result = this.mapDeleteResult(
      await this.taxonomyService.deleteCategory(input.id, input.replacementCategoryId),
    );
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_CATEGORY_DELETED,
      resourceId: input.id,
      kind: 'category',
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => DeleteTaxonomyResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteTag(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('id') id: string,
    @Context() context?: GraphqlContext,
  ): Promise<DeleteTaxonomyResultType> {
    const result = this.mapDeleteResult(await this.taxonomyService.deleteTag(id));
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_TAG_DELETED,
      resourceId: id,
      kind: 'tag',
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => DeleteTaxonomyResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deletePetType(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: DeleteTaxonomyInput,
    @Context() context?: GraphqlContext,
  ): Promise<DeleteTaxonomyResultType> {
    const result = this.mapDeleteResult(await this.taxonomyService.deletePetType(input.id));
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_PET_TYPE_DELETED,
      resourceId: input.id,
      kind: 'pet_type',
      req: context?.req,
    });
    return result;
  }

  @Mutation(() => DeleteTaxonomyResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteBrand(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: DeleteTaxonomyInput,
    @Context() context?: GraphqlContext,
  ): Promise<DeleteTaxonomyResultType> {
    const result = this.mapDeleteResult(await this.taxonomyService.deleteBrand(input.id));
    await this.logTaxonomyAudit({
      adminId,
      adminEmail,
      action: AuditAction.TAXONOMY_BRAND_DELETED,
      resourceId: input.id,
      kind: 'brand',
      req: context?.req,
    });
    return result;
  }
}
