import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  const favoriteRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
  const productRepository = {
    findOne: jest.fn(),
  };

  const service = new FavoritesService(favoriteRepository as never, productRepository as never);

  function mockListQuery() {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    favoriteRepository.createQueryBuilder.mockReturnValue(qb);
    return qb;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('defaults to page 1 and limit 24 with product, store, and one image', async () => {
      const qb = mockListQuery();

      await service.list('cust-1');

      expect(qb.where).toHaveBeenCalledWith('favorite.customerId = :customerId', {
        customerId: 'cust-1',
      });
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('favorite.product', 'product');
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('product.store', 'store');
      const calls = qb.leftJoinAndSelect.mock.calls as unknown[][];
      const imageJoin = calls.find((call) => call[0] === 'product.images');
      expect(String(imageJoin?.[2])).toContain('LIMIT 1');
      expect(String(imageJoin?.[2])).toContain('is_thumbnail DESC');
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(24);
      expect(calls.some((call) => call[0] === 'product.variants')).toBe(false);
    });

    it('caps limit at 100', async () => {
      const qb = mockListQuery();

      await service.list('cust-1', 2, 500);

      expect(qb.skip).toHaveBeenCalledWith(100);
      expect(qb.take).toHaveBeenCalledWith(100);
    });
  });
});
