import 'reflect-metadata';
import { TaxonomyResolver } from './taxonomy.resolver';
import { TaxonomyService } from './taxonomy.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { UserRole } from '../../database/entities/user.entity';
import { TaxonomyApprovalStatus } from '../../database/entities/enums/taxonomy.enums';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@sopet.org';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const ENTITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const graphqlContext: GraphqlContext = {
  req: { requestId: 'req-taxonomy-1', headers: { 'x-forwarded-for': '203.0.113.10' } },
  res: {},
  loaders: { productSoldCount: { load: jest.fn() } as never },
};

function taxonomyEntity(kind: 'category' | 'tag' | 'petType' | 'brand') {
  const base = {
    id: ENTITY_ID,
    name: `${kind}-name`,
    slug: `${kind}-slug`,
    approvalStatus: TaxonomyApprovalStatus.APPROVED,
    createdBy: ADMIN_ID,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  if (kind === 'category' || kind === 'petType') {
    return { ...base, imageUrl: null };
  }
  return base;
}

describe('TaxonomyResolver audit logging', () => {
  let resolver: TaxonomyResolver;
  let taxonomyService: {
    createCategory: jest.Mock;
    updateCategory: jest.Mock;
    setCategoryImage: jest.Mock;
    createTag: jest.Mock;
    updateTag: jest.Mock;
    approveCategory: jest.Mock;
    rejectCategory: jest.Mock;
    approveTag: jest.Mock;
    rejectTag: jest.Mock;
    createPetType: jest.Mock;
    updatePetType: jest.Mock;
    setPetTypeImage: jest.Mock;
    createBrand: jest.Mock;
    updateBrand: jest.Mock;
    approvePetType: jest.Mock;
    rejectPetType: jest.Mock;
    approveBrand: jest.Mock;
    rejectBrand: jest.Mock;
    deleteCategory: jest.Mock;
    deleteTag: jest.Mock;
    deletePetType: jest.Mock;
    deleteBrand: jest.Mock;
  };
  let auditLogsService: { log: jest.Mock };

  beforeEach(() => {
    taxonomyService = {
      createCategory: jest.fn(),
      updateCategory: jest.fn(),
      setCategoryImage: jest.fn(),
      createTag: jest.fn(),
      updateTag: jest.fn(),
      approveCategory: jest.fn(),
      rejectCategory: jest.fn(),
      approveTag: jest.fn(),
      rejectTag: jest.fn(),
      createPetType: jest.fn(),
      updatePetType: jest.fn(),
      setPetTypeImage: jest.fn(),
      createBrand: jest.fn(),
      updateBrand: jest.fn(),
      approvePetType: jest.fn(),
      rejectPetType: jest.fn(),
      approveBrand: jest.fn(),
      rejectBrand: jest.fn(),
      deleteCategory: jest.fn(),
      deleteTag: jest.fn(),
      deletePetType: jest.fn(),
      deleteBrand: jest.fn(),
    };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    resolver = new TaxonomyResolver(
      taxonomyService as unknown as TaxonomyService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  const expectedLog = (action: string, kind: string) => ({
    actorType: AuditActorType.ADMIN,
    actorId: ADMIN_ID,
    actorLabel: ADMIN_EMAIL,
    action,
    resourceType: AuditResourceType.TAXONOMY,
    resourceId: ENTITY_ID,
    metadata: { kind },
    requestId: 'req-taxonomy-1',
    ipAddress: '203.0.113.10',
  });

  describe('create* admin vs vendor (AC-B-001)', () => {
    it('logs taxonomy.category.created once when the actor is admin', async () => {
      taxonomyService.createCategory.mockResolvedValue(taxonomyEntity('category'));

      await resolver.createCategory(
        ADMIN_ID,
        UserRole.ADMIN,
        ADMIN_EMAIL,
        { name: 'Food' },
        graphqlContext,
      );

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_CATEGORY_CREATED, 'category')),
      );
    });

    it('does not log when createCategory actor is vendor', async () => {
      taxonomyService.createCategory.mockResolvedValue(taxonomyEntity('category'));

      await resolver.createCategory(VENDOR_ID, UserRole.VENDOR, 'vendor@sopet.org', {
        name: 'Food',
      });

      expect(auditLogsService.log).not.toHaveBeenCalled();
    });

    it('logs taxonomy.tag.created once when the actor is admin', async () => {
      taxonomyService.createTag.mockResolvedValue(taxonomyEntity('tag'));

      await resolver.createTag(
        ADMIN_ID,
        UserRole.ADMIN,
        ADMIN_EMAIL,
        { name: 'Organic' },
        graphqlContext,
      );

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_TAG_CREATED, 'tag')),
      );
    });

    it('does not log when createTag actor is vendor', async () => {
      taxonomyService.createTag.mockResolvedValue(taxonomyEntity('tag'));

      await resolver.createTag(VENDOR_ID, UserRole.VENDOR, 'vendor@sopet.org', { name: 'Organic' });

      expect(auditLogsService.log).not.toHaveBeenCalled();
    });

    it('logs taxonomy.pet_type.created once when the actor is admin', async () => {
      taxonomyService.createPetType.mockResolvedValue(taxonomyEntity('petType'));

      await resolver.createPetType(
        ADMIN_ID,
        UserRole.ADMIN,
        ADMIN_EMAIL,
        { name: 'Dog' },
        graphqlContext,
      );

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_PET_TYPE_CREATED, 'pet_type')),
      );
    });

    it('does not log when createPetType actor is vendor', async () => {
      taxonomyService.createPetType.mockResolvedValue(taxonomyEntity('petType'));

      await resolver.createPetType(VENDOR_ID, UserRole.VENDOR, 'vendor@sopet.org', { name: 'Dog' });

      expect(auditLogsService.log).not.toHaveBeenCalled();
    });

    it('logs taxonomy.brand.created once when the actor is admin', async () => {
      taxonomyService.createBrand.mockResolvedValue(taxonomyEntity('brand'));

      await resolver.createBrand(
        ADMIN_ID,
        UserRole.ADMIN,
        ADMIN_EMAIL,
        { name: 'Royal Canin' },
        graphqlContext,
      );

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_BRAND_CREATED, 'brand')),
      );
    });

    it('does not log when createBrand actor is vendor', async () => {
      taxonomyService.createBrand.mockResolvedValue(taxonomyEntity('brand'));

      await resolver.createBrand(VENDOR_ID, UserRole.VENDOR, 'vendor@sopet.org', {
        name: 'Royal Canin',
      });

      expect(auditLogsService.log).not.toHaveBeenCalled();
    });
  });

  describe('admin-only mutations write one row', () => {
    it('logs taxonomy.category.approved', async () => {
      taxonomyService.approveCategory.mockResolvedValue(taxonomyEntity('category'));

      await resolver.approveCategory(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_CATEGORY_APPROVED, 'category')),
      );
    });

    it('logs taxonomy.category.rejected', async () => {
      taxonomyService.rejectCategory.mockResolvedValue(taxonomyEntity('category'));

      await resolver.rejectCategory(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_CATEGORY_REJECTED, 'category')),
      );
    });

    it('logs taxonomy.category.updated', async () => {
      taxonomyService.updateCategory.mockResolvedValue(taxonomyEntity('category'));

      await resolver.updateCategory(
        ADMIN_ID,
        ADMIN_EMAIL,
        { categoryId: ENTITY_ID, name: 'Food' },
        graphqlContext,
      );

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_CATEGORY_UPDATED, 'category')),
      );
    });

    it('logs taxonomy.category.image_set', async () => {
      taxonomyService.setCategoryImage.mockResolvedValue(taxonomyEntity('category'));

      await resolver.setCategoryImage(
        ADMIN_ID,
        ADMIN_EMAIL,
        { categoryId: ENTITY_ID, imageUrl: 'https://cdn.example/cat.png' },
        graphqlContext,
      );

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_CATEGORY_IMAGE_SET, 'category')),
      );
    });

    it('logs taxonomy.category.deleted with the input id', async () => {
      taxonomyService.deleteCategory.mockResolvedValue({
        success: true,
        deletedId: ENTITY_ID,
        detachedProductCount: 0,
        notifiedStoreCount: 0,
      });

      await resolver.deleteCategory(ADMIN_ID, ADMIN_EMAIL, { id: ENTITY_ID }, graphqlContext);

      expect(auditLogsService.log).toHaveBeenCalledTimes(1);
      expect(auditLogsService.log).toHaveBeenCalledWith(
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_CATEGORY_DELETED, 'category')),
      );
    });

    it('logs taxonomy.tag.approved / rejected / updated / deleted', async () => {
      taxonomyService.approveTag.mockResolvedValue(taxonomyEntity('tag'));
      taxonomyService.rejectTag.mockResolvedValue(taxonomyEntity('tag'));
      taxonomyService.updateTag.mockResolvedValue(taxonomyEntity('tag'));
      taxonomyService.deleteTag.mockResolvedValue({
        success: true,
        deletedId: ENTITY_ID,
        detachedProductCount: 0,
        notifiedStoreCount: 0,
      });

      await resolver.approveTag(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);
      await resolver.rejectTag(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);
      await resolver.updateTag(
        ADMIN_ID,
        ADMIN_EMAIL,
        { tagId: ENTITY_ID, name: 'Organic' },
        graphqlContext,
      );
      await resolver.deleteTag(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);

      expect(auditLogsService.log).toHaveBeenCalledTimes(4);
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_TAG_APPROVED, 'tag')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_TAG_REJECTED, 'tag')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_TAG_UPDATED, 'tag')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_TAG_DELETED, 'tag')),
      );
    });

    it('logs pet_type approve/reject/update/image_set/deleted', async () => {
      taxonomyService.approvePetType.mockResolvedValue(taxonomyEntity('petType'));
      taxonomyService.rejectPetType.mockResolvedValue(taxonomyEntity('petType'));
      taxonomyService.updatePetType.mockResolvedValue(taxonomyEntity('petType'));
      taxonomyService.setPetTypeImage.mockResolvedValue(taxonomyEntity('petType'));
      taxonomyService.deletePetType.mockResolvedValue({
        success: true,
        deletedId: ENTITY_ID,
        detachedProductCount: 0,
        notifiedStoreCount: 0,
      });

      await resolver.approvePetType(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);
      await resolver.rejectPetType(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);
      await resolver.updatePetType(
        ADMIN_ID,
        ADMIN_EMAIL,
        { petTypeId: ENTITY_ID, name: 'Dog' },
        graphqlContext,
      );
      await resolver.setPetTypeImage(
        ADMIN_ID,
        ADMIN_EMAIL,
        { petTypeId: ENTITY_ID, imageUrl: 'https://cdn.example/dog.png' },
        graphqlContext,
      );
      await resolver.deletePetType(ADMIN_ID, ADMIN_EMAIL, { id: ENTITY_ID }, graphqlContext);

      expect(auditLogsService.log).toHaveBeenCalledTimes(5);
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_PET_TYPE_APPROVED, 'pet_type')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_PET_TYPE_REJECTED, 'pet_type')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_PET_TYPE_UPDATED, 'pet_type')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_PET_TYPE_IMAGE_SET, 'pet_type')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        5,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_PET_TYPE_DELETED, 'pet_type')),
      );
    });

    it('logs brand approve/reject/update/deleted', async () => {
      taxonomyService.approveBrand.mockResolvedValue(taxonomyEntity('brand'));
      taxonomyService.rejectBrand.mockResolvedValue(taxonomyEntity('brand'));
      taxonomyService.updateBrand.mockResolvedValue(taxonomyEntity('brand'));
      taxonomyService.deleteBrand.mockResolvedValue({
        success: true,
        deletedId: ENTITY_ID,
        detachedProductCount: 0,
        notifiedStoreCount: 0,
      });

      await resolver.approveBrand(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);
      await resolver.rejectBrand(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);
      await resolver.updateBrand(
        ADMIN_ID,
        ADMIN_EMAIL,
        { brandId: ENTITY_ID, name: 'Royal Canin' },
        graphqlContext,
      );
      await resolver.deleteBrand(ADMIN_ID, ADMIN_EMAIL, { id: ENTITY_ID }, graphqlContext);

      expect(auditLogsService.log).toHaveBeenCalledTimes(4);
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_BRAND_APPROVED, 'brand')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_BRAND_REJECTED, 'brand')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_BRAND_UPDATED, 'brand')),
      );
      expect(auditLogsService.log).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining(expectedLog(AuditAction.TAXONOMY_BRAND_DELETED, 'brand')),
      );
    });
  });
});
