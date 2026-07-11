// Category Taxonomy Image & Delete integration Test - Design Doc: category-taxonomy-image-delete-backend-design.md
// Generated: 2026-07-07 | Budget Used: integration 3/3, fixture-e2e 0/3, service-e2e 0/2
//
// AC1: "When admin calls approveCategory on a category with null/empty imageUrl, the system shall reject with code CATEGORY_IMAGE_REQUIRED and a Thai message (AC-001)"
// ROI: 81 (BV:9 × Freq:8 + Legal:0 + Defect:9)
// Behavior: Admin invokes approveCategory on pending category without imageUrl → HttpException with code CATEGORY_IMAGE_REQUIRED; category remains pending; no approvalStatus mutation persisted
// @category: core-functionality
// @lane: integration
// @dependency: TaxonomyService, StorageService (mock assertFolderImageUrl), Category repository (mock)
// @complexity: medium
// Primary failure mode: approveCategory succeeds or persists approved status when imageUrl is null/empty — approval gate regresses to pre-feature behavior
// Proof obligation: seed pending category with imageUrl null and empty string variants; invoke approveCategory; assert thrown exception response.code === CATEGORY_IMAGE_REQUIRED and repository save for approval was not called. Mock StorageService only if URL validation is not on approve path; category row must remain pending after failure
// Verification points / expected results / pass criteria:
// - approveCategory throws BadRequestException (or equivalent) with response.code CATEGORY_IMAGE_REQUIRED
// - User-facing message matches Thai copy from design doc (ต้องอัปโหลดรูปภาพหมวดหมู่ก่อนอนุมัติ)
// - Category approvalStatus unchanged (pending)
// - No partial DB update on category row
//
// AC2: "When admin calls setCategoryImage with a valid categories/ URL on a pending category, the system shall persist imageUrl and allow subsequent approveCategory success (AC-002)"
// ROI: 80 (BV:9 × Freq:8 + Legal:0 + Defect:8)
// Behavior: setCategoryImage with valid categories/ URL on pending category → imageUrl persisted → approveCategory succeeds → approved status returned
// @category: core-functionality
// @lane: integration
// @dependency: TaxonomyService, StorageService, Category repository (mock)
// @complexity: medium
// Primary failure mode: imageUrl not persisted after setCategoryImage, or approveCategory still rejects after valid image set
// Proof obligation: mock StorageService.assertFolderImageUrl to accept URL under categories/ prefix; call setCategoryImage then approveCategory in sequence; assert save called with imageUrl and final approvalStatus approved. Traverses upload-validation boundary (valid prefix) and approve gate happy path
// Verification points / expected results / pass criteria:
// - setCategoryImage returns category with non-null imageUrl matching input
// - assertFolderImageUrl invoked with folder categories
// - approveCategory after setCategoryImage returns approvalStatus approved
// - CATEGORY_IMAGE_REQUIRED not thrown on second step
//
// AC3: "When admin calls createCategory with name only, the system shall create category with approvalStatus pending and imageUrl null (AC-004)"
// ROI: 78 (BV:9 × Freq:7 + Legal:0 + Defect:9)
// Behavior: Admin createCategory(name only) → category created with approvalStatus pending and imageUrl null (regression vs legacy admin auto-approve)
// @category: integration
// @lane: integration
// @dependency: TaxonomyService, Category repository (mock)
// @complexity: low
// Primary failure mode: admin createCategory still returns approvalStatus approved — breaking change not applied
// Proof obligation: invoke createCategory with UserRole.ADMIN and no imageUrl; assert returned entity approvalStatus === pending and imageUrl null; verify resolveApprovalStatus auto-approve path not used for categories. Boundary: admin role input class that previously auto-approved
// Verification points / expected results / pass criteria:
// - createCategory(admin) returns approvalStatus pending
// - imageUrl is null
// - slug and name persisted per existing conventions
// - Replaces legacy taxonomy.service.spec.ts admin-auto-approve expectation

import { BadRequestException } from '@nestjs/common';
import { TaxonomyService } from '../src/modules/taxonomy/taxonomy.service';
import { TaxonomyApprovalStatus } from '../src/database/entities/enums/taxonomy.enums';
import { UserRole } from '../src/database/entities/user.entity';
import type { Category } from '../src/database/entities/category.entity';

const CATEGORY_IMAGE_REQUIRED_MESSAGE = 'ต้องอัปโหลดรูปภาพหมวดหมู่ก่อนอนุมัติ';
const VALID_CATEGORY_IMAGE_URL =
  'https://cdn.example.com/categories/a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp';

type CategoryWithImage = Category & { imageUrl?: string | null };

/** Target TaxonomyService contract for category image pipeline (Phase 2). */
interface CategoryImageTaxonomyService {
  createCategory(
    name: string,
    createdBy: string,
    role: string,
    imageUrl?: string | null,
  ): Promise<CategoryWithImage>;
  setCategoryImage(categoryId: string, imageUrl: string): Promise<CategoryWithImage>;
  approveCategory(id: string): Promise<CategoryWithImage>;
}

interface StorageServiceMock {
  assertFolderImageUrl: jest.Mock;
}

function getExceptionPayload(error: unknown): { code?: string; message?: string } {
  if (error instanceof BadRequestException) {
    return error.getResponse() as { code?: string; message?: string };
  }
  return {};
}

describe('Category taxonomy image pipeline (integration)', () => {
  let service: CategoryImageTaxonomyService;
  let categoryStore: Map<string, CategoryWithImage>;
  let categoryRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let tagRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let storageService: StorageServiceMock;

  beforeEach(() => {
    categoryStore = new Map();

    categoryRepository = {
      find: jest.fn(),
      findOne: jest.fn(async ({ where: { id, slug, name } }) => {
        if (id) {
          return categoryStore.get(id) ?? null;
        }
        if (slug) {
          return [...categoryStore.values()].find((category) => category.slug === slug) ?? null;
        }
        if (name) {
          const normalized = String(name).toLowerCase();
          return (
            [...categoryStore.values()].find(
              (category) =>
                category.name.toLowerCase() === normalized &&
                category.approvalStatus !== TaxonomyApprovalStatus.REJECTED,
            ) ?? null
          );
        }
        return null;
      }),
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (data: CategoryWithImage) => {
        const saved = {
          ...data,
          id: data.id ?? `cat-${categoryStore.size + 1}`,
        };
        categoryStore.set(saved.id, saved);
        return saved;
      }),
    };

    tagRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: data.id ?? 'tag-1' })),
    };

    storageService = {
      assertFolderImageUrl: jest.fn(async (_url: string, folder: string) => {
        if (folder !== 'categories') {
          throw new BadRequestException({
            code: 'INVALID_CATEGORY_IMAGE_URL',
            message: 'Invalid category image URL',
          });
        }
      }),
    };

    const taxonomyService = new TaxonomyService(
      categoryRepository as never,
      tagRepository as never,
      storageService as never,
    );

    service = taxonomyService;
  });

  async function seedPendingCategory(
    overrides: Partial<CategoryWithImage> = {},
  ): Promise<CategoryWithImage> {
    const category: CategoryWithImage = {
      id: overrides.id ?? 'pending-cat-1',
      name: overrides.name ?? 'Pending Category',
      slug: overrides.slug ?? 'pending-category',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
      createdBy: overrides.createdBy ?? 'admin-1',
      createdAt: overrides.createdAt ?? new Date(),
      updatedAt: overrides.updatedAt ?? new Date(),
      imageUrl: overrides.imageUrl ?? null,
      products: [],
      creator: undefined as never,
    };

    categoryStore.set(category.id, category);
    return category;
  }

  describe('AC-001: approveCategory image gate', () => {
    it('rejects approveCategory when imageUrl is null or empty', async () => {
      for (const imageUrl of [null, ''] as const) {
        categoryStore.clear();
        categoryRepository.save.mockClear();

        const category = await seedPendingCategory({
          id: `pending-${imageUrl ?? 'null'}`,
          imageUrl,
        });
        const saveCallsBefore = categoryRepository.save.mock.calls.length;

        let caught: unknown;
        try {
          await service.approveCategory(category.id);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(BadRequestException);
        const payload = getExceptionPayload(caught);
        expect(payload.code).toBe('CATEGORY_IMAGE_REQUIRED');
        expect(payload.message).toBe(CATEGORY_IMAGE_REQUIRED_MESSAGE);

        const persisted = categoryStore.get(category.id);
        expect(persisted?.approvalStatus).toBe(TaxonomyApprovalStatus.PENDING);
        expect(categoryRepository.save.mock.calls.length).toBe(saveCallsBefore);
      }
    });
  });

  describe('AC-002: setCategoryImage then approveCategory', () => {
    it('persists imageUrl and allows approveCategory success', async () => {
      const category = await seedPendingCategory({ imageUrl: null });

      const updated = await service.setCategoryImage(category.id, VALID_CATEGORY_IMAGE_URL);

      expect(storageService.assertFolderImageUrl).toHaveBeenCalledWith(
        VALID_CATEGORY_IMAGE_URL,
        'categories',
      );
      expect(updated.imageUrl).toBe(VALID_CATEGORY_IMAGE_URL);

      const approved = await service.approveCategory(category.id);

      expect(approved.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
      expect(approved.imageUrl).toBe(VALID_CATEGORY_IMAGE_URL);
      expect(categoryStore.get(category.id)?.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
    });
  });

  describe('AC-004: admin createCategory always pending', () => {
    it('creates category with approvalStatus pending and imageUrl null', async () => {
      categoryRepository.findOne.mockImplementation(async ({ where: { slug, name } }) => {
        if (slug) {
          return [...categoryStore.values()].find((category) => category.slug === slug) ?? null;
        }
        if (name) {
          const normalized = String(name).toLowerCase();
          return (
            [...categoryStore.values()].find(
              (category) =>
                category.name.toLowerCase() === normalized &&
                category.approvalStatus !== TaxonomyApprovalStatus.REJECTED,
            ) ?? null
          );
        }
        return null;
      });

      const category = await service.createCategory('Dog Food', 'admin-1', UserRole.ADMIN);

      expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.PENDING);
      expect(category.imageUrl ?? null).toBeNull();
      expect(category.name).toBe('Dog Food');
      expect(category.slug).toBe('dog-food');
      expect(categoryRepository.save).toHaveBeenCalled();
    });
  });
});
