import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyApprovalStatus } from '../../database/entities/enums/taxonomy.enums';
import { UserRole } from '../../database/entities/user.entity';

describe('TaxonomyService', () => {
  let service: TaxonomyService;
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

  beforeEach(() => {
    categoryRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: data.id ?? 'cat-1' })),
    };
    tagRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: data.id ?? 'tag-1' })),
    };

    service = new TaxonomyService(categoryRepository as never, tagRepository as never);
  });

  it('creates approved category for admin', async () => {
    categoryRepository.findOne.mockResolvedValue(null);

    const category = await service.createCategory('Cat Food', 'admin-1', UserRole.ADMIN);

    expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
    expect(category.slug).toBe('cat-food');
    expect(categoryRepository.save).toHaveBeenCalled();
  });

  it('creates pending category for vendor', async () => {
    categoryRepository.findOne.mockResolvedValue(null);

    const category = await service.createCategory('Dog Treats', 'vendor-1', UserRole.VENDOR);

    expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.PENDING);
  });

  it('rejects duplicate category name (case-insensitive) with a conflict', async () => {
    categoryRepository.findOne.mockResolvedValue({ id: 'existing', name: 'Cat Food' });

    await expect(
      service.createCategory('cat food', 'vendor-1', UserRole.VENDOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(categoryRepository.save).not.toHaveBeenCalled();
  });

  it('rejects duplicate tag name (case-insensitive) with a conflict', async () => {
    tagRepository.findOne.mockResolvedValue({ id: 'existing', name: 'Puppy' });

    await expect(service.createTag('PUPPY', 'vendor-1', UserRole.VENDOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tagRepository.save).not.toHaveBeenCalled();
  });

  it('translates a DB unique violation into a conflict error', async () => {
    categoryRepository.findOne.mockResolvedValue(null);
    categoryRepository.save.mockRejectedValue(
      new QueryFailedError('query', [], {
        code: '23505',
      } as unknown as Error),
    );

    await expect(
      service.createCategory('Cat Food', 'vendor-1', UserRole.VENDOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('approves category', async () => {
    categoryRepository.findOne.mockResolvedValue({
      id: 'cat-1',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
    });

    const category = await service.approveCategory('cat-1');

    expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
  });

  it('rejects unapproved tags for product assignment', async () => {
    tagRepository.findOne.mockResolvedValue({
      id: 'tag-1',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
    });
    tagRepository.find.mockResolvedValue([
      { id: 'tag-1', approvalStatus: TaxonomyApprovalStatus.PENDING },
    ]);

    await expect(service.getApprovedTags(['tag-1'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when category is missing', async () => {
    categoryRepository.findOne.mockResolvedValue(null);

    await expect(service.getApprovedCategory('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
