import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';

describe('CartService', () => {
  let service: CartService;
  let cartRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let cartItemRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let variantRepository: {
    findOne: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let mockTrx: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  const cartWithItems = {
    id: 'cart-1',
    customerId: 'cust-1',
    items: [{ id: 'item-1', variantId: 'var-1', quantity: 2 }],
  };

  beforeEach(() => {
    cartRepository = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: 'cart-1' })),
      create: jest.fn().mockImplementation((data) => data),
      delete: jest.fn(),
    };
    cartItemRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn().mockImplementation((data) => data),
      delete: jest.fn(),
    };
    mockTrx = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation(async (entity) => entity),
      create: jest.fn((_entity, data) => data),
    };
    variantRepository = {
      findOne: jest.fn(),
      manager: {
        transaction: jest.fn(async (cb) => cb(mockTrx)),
      },
    };

    service = new CartService(
      cartRepository as never,
      cartItemRepository as never,
      variantRepository as never,
    );
  });

  it('requires customer or session identity', async () => {
    await expect(service.getCart()).rejects.toThrow(BadRequestException);
  });

  it('creates cart when none exists', async () => {
    cartRepository.findOne.mockResolvedValue(null);

    const cart = await service.getCart('cust-1');

    expect(cartRepository.save).toHaveBeenCalled();
    expect(cart.items).toEqual([]);
  });

  it('rejects addItem when variant missing', async () => {
    mockTrx.findOne.mockResolvedValue(null);
    cartRepository.findOne.mockResolvedValue(cartWithItems);

    await expect(service.addItem('missing', 1, 'cust-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects addItem when insufficient stock', async () => {
    mockTrx.findOne.mockResolvedValue({ id: 'var-1', stockQuantity: 1 });
    cartRepository.findOne.mockResolvedValue(cartWithItems);

    await expect(service.addItem('var-1', 5, 'cust-1')).rejects.toThrow(BadRequestException);
  });

  it('adds new item to cart', async () => {
    mockTrx.findOne.mockResolvedValue({ id: 'var-2', stockQuantity: 10 });
    cartRepository.findOne
      .mockResolvedValueOnce({ ...cartWithItems, items: [] })
      .mockResolvedValueOnce({ ...cartWithItems, items: [{ variantId: 'var-2', quantity: 1 }] });

    await service.addItem('var-2', 1, 'cust-1');

    expect(mockTrx.save).toHaveBeenCalled();
  });

  it('updates existing cart item quantity', async () => {
    mockTrx.findOne.mockResolvedValue({ id: 'var-1', stockQuantity: 10 });
    cartRepository.findOne.mockResolvedValue(cartWithItems);

    await service.addItem('var-1', 1, 'cust-1');

    expect(mockTrx.save).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
  });

  it('removes item when quantity is zero', async () => {
    cartRepository.findOne.mockResolvedValue(cartWithItems);
    cartItemRepository.findOne.mockResolvedValue({ id: 'item-1', cartId: 'cart-1' });

    await service.updateItem('item-1', 0, 'cust-1');

    expect(cartItemRepository.delete).toHaveBeenCalledWith('item-1');
  });

  it('merges guest cart items into customer cart', async () => {
    const guestCart = {
      id: 'guest-cart',
      items: [{ id: 'item-1', variantId: 'var-1', quantity: 2 }],
    };
    const customerCart = {
      id: 'customer-cart',
      customerId: 'cust-1',
      items: [],
    };

    cartRepository.findOne
      .mockResolvedValueOnce(guestCart)
      .mockResolvedValueOnce(customerCart)
      .mockResolvedValueOnce({
        ...customerCart,
        items: [{ id: 'item-2', variantId: 'var-1', quantity: 2 }],
      });

    const result = await service.mergeGuestCart('cust-1', 'session-abc');
    expect(cartItemRepository.save).toHaveBeenCalled();
    expect(cartRepository.delete).toHaveBeenCalledWith({ id: 'guest-cart' });
    expect(result.id).toBe('customer-cart');
  });

  it('returns customer cart when guest cart is empty', async () => {
    cartRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(cartWithItems);

    const result = await service.mergeGuestCart('cust-1', 'session-empty');
    expect(result.customerId).toBe('cust-1');
  });

  it('throws when cart item not found on update', async () => {
    cartRepository.findOne.mockResolvedValue(cartWithItems);
    cartItemRepository.findOne.mockResolvedValue(null);

    await expect(service.updateItem('missing', 2, 'cust-1')).rejects.toThrow(NotFoundException);
  });

  it('removes cart item', async () => {
    cartRepository.findOne.mockResolvedValue(cartWithItems);

    await service.removeItem('item-1', 'cust-1');

    expect(cartItemRepository.delete).toHaveBeenCalledWith({
      id: 'item-1',
      cartId: 'cart-1',
    });
  });
});
