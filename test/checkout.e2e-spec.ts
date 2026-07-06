import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { CartService } from '../src/modules/cart/cart.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { Customer } from '../src/database/entities/customer.entity';
import { User } from '../src/database/entities/user.entity';
import { OtpCode } from '../src/database/entities/otp-code.entity';
import { Store } from '../src/database/entities/store.entity';
import { StoreMember } from '../src/database/entities/store-member.entity';
import { PasswordResetToken } from '../src/database/entities/password-reset-token.entity';
import { OrderStatus } from '../src/database/entities/order.entity';
import { SmsService } from '../src/modules/sms/sms.service';
import { EmailDeliveryService } from '../src/modules/email/email-delivery.service';

describe('Checkout flow (integration)', () => {
  describe('OTP → mergeCart', () => {
    let authService: AuthService;
    const cartService = { mergeGuestCart: jest.fn() };
    const otpRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
      findOne: jest.fn(),
    };
    const customerRepo = {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 'cust-1' })),
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: getRepositoryToken(Customer), useValue: customerRepo },
          { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(), save: jest.fn() } },
          { provide: getRepositoryToken(OtpCode), useValue: otpRepo },
          { provide: getRepositoryToken(Store), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(StoreMember), useValue: { findOne: jest.fn() } },
          {
            provide: getRepositoryToken(PasswordResetToken),
            useValue: { findOne: jest.fn(), save: jest.fn(), delete: jest.fn() },
          },
          {
            provide: JwtService,
            useValue: { signAsync: jest.fn(async (p) => `tok-${p.type}`) },
          },
          {
            provide: ConfigService,
            useValue: { get: jest.fn(() => '15m') },
          },
          { provide: SmsService, useValue: { sendOtp: jest.fn() } },
          { provide: CartService, useValue: cartService },
          { provide: EmailDeliveryService, useValue: { sendPasswordReset: jest.fn() } },
        ],
      }).compile();

      authService = module.get(AuthService);
    });

    it('verifies OTP and merges guest cart', async () => {
      otpRepo.findOne.mockResolvedValue({
        phone: '+66812345678',
        code: '654321',
        isUsed: false,
      });
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        phone: '+66812345678',
        isActive: true,
      });
      cartService.mergeGuestCart.mockResolvedValue({ id: 'cart-1', items: [] });

      const result = await authService.verifyOtp({
        phone: '+66812345678',
        code: '654321',
        sessionId: 'guest-session',
      });

      expect(cartService.mergeGuestCart).toHaveBeenCalledWith('cust-1', 'guest-session');
      expect(result.accessToken).toBeDefined();
    });
  });

  describe('guest checkout → createOrder', () => {
    let ordersService: OrdersService;
    let variantRepository: { findOne: jest.Mock };
    let orderRepository: { findOne: jest.Mock };
    let mockManager: {
      create: jest.Mock;
      save: jest.Mock;
      findOne: jest.Mock;
      update: jest.Mock;
      increment: jest.Mock;
    };

    const variant = {
      id: 'var-1',
      productId: 'prod-1',
      stockQuantity: 5,
      options: {},
      product: { id: 'prod-1', storeId: 'store-1', name: 'Treats' },
    };

    beforeEach(() => {
      variantRepository = { findOne: jest.fn().mockResolvedValue(variant) };
      orderRepository = { findOne: jest.fn() };
      mockManager = {
        create: jest.fn((_e, data) => ({ ...data })),
        save: jest.fn(async (_e, data?) => {
          const payload = data ?? _e;
          if (Array.isArray(payload)) return payload;
          return { ...payload, id: 'ord-guest-1' };
        }),
        findOne: jest.fn().mockResolvedValue(variant),
        update: jest.fn(),
        increment: jest.fn(),
      };

      ordersService = new OrdersService(
        orderRepository as never,
        {} as never,
        { findOne: jest.fn() } as never,
        variantRepository as never,
        {} as never,
        { findOne: jest.fn() } as never,
        { transaction: jest.fn(async (cb) => cb(mockManager)) } as never,
        {
          notifyOrderStatusChanged: jest.fn(),
          notifyVendorAboutNewOrder: jest.fn().mockResolvedValue(undefined),
        } as never,
        { applyStackedPromotions: jest.fn() } as never,
      );
    });

    it('rejects guest order without phone', async () => {
      await expect(
        ordersService.create({
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 50 }],
          paymentMethod: 'cod',
          shippingAddress: {
            recipientName: 'Guest',
            recipientPhone: '+66812345678',
            addressLine1: '1 Test Rd',
            amphoe: 'Test',
            province: 'Bangkok',
            postalCode: '10110',
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates guest order with phone and address', async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 'ord-guest-1',
        status: OrderStatus.PENDING_PAYMENT,
        guestPhone: '+66899998888',
        items: [],
        shippingAddress: {},
        storeShippings: [],
        statusHistory: [],
      });

      const order = await ordersService.create({
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 50 }],
        paymentMethod: 'cod',
        guestPhone: '+66899998888',
        shippingAddress: {
          recipientName: 'Guest',
          recipientPhone: '+66899998888',
          addressLine1: '1 Test Rd',
          amphoe: 'Test',
          province: 'Bangkok',
          postalCode: '10110',
        },
      });

      expect(order.id).toBe('ord-guest-1');
      expect(mockManager.save).toHaveBeenCalled();
    });
  });
});
