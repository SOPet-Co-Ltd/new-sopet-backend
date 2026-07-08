import 'reflect-metadata';
import { PaymentsResolver } from './payments.resolver';
import { PaymentsService } from './payments.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

describe('PaymentsResolver payment queries', () => {
  let paymentsService: jest.Mocked<
    Pick<PaymentsService, 'findById' | 'findLatestByOrderId' | 'createCharge' | 'refund'>
  >;
  let resolver: PaymentsResolver;

  const paymentEntity = {
    id: 'pay-1',
    orderId: 'ord-1',
    amount: 100,
    currency: 'THB',
    status: 'pending',
    paymentMethod: 'promptpay',
    authorizeUri: 'https://example.com/authorize',
    qrCodeUrl: 'https://example.com/qr.png',
  };

  beforeEach(() => {
    paymentsService = {
      findById: jest.fn(),
      findLatestByOrderId: jest.fn(),
      createCharge: jest.fn(),
      refund: jest.fn(),
    };
    resolver = new PaymentsResolver(paymentsService as unknown as PaymentsService);
  });

  describe('payment', () => {
    it('is decorated with @Public()', () => {
      const paymentMethod = Object.getOwnPropertyDescriptor(PaymentsResolver.prototype, 'payment')
        ?.value as (...args: unknown[]) => unknown;
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, paymentMethod) as boolean | undefined;
      expect(isPublic).toBe(true);
    });

    it('maps payment entity to PaymentType for guest', async () => {
      paymentsService.findById.mockResolvedValue(paymentEntity as never);

      const result = await resolver.payment('pay-1', undefined, undefined);

      expect(paymentsService.findById).toHaveBeenCalledWith('pay-1', undefined);
      expect(result).toEqual({
        id: 'pay-1',
        orderId: 'ord-1',
        amount: 100,
        currency: 'THB',
        status: 'pending',
        paymentMethod: 'promptpay',
        authorizeUri: 'https://example.com/authorize',
        qrCodeUrl: 'https://example.com/qr.png',
      });
    });

    it('passes customer id when role is customer', async () => {
      paymentsService.findById.mockResolvedValue(paymentEntity as never);

      await resolver.payment('pay-1', 'cust-1', 'customer');

      expect(paymentsService.findById).toHaveBeenCalledWith('pay-1', 'cust-1');
    });

    it('ignores non-customer roles for ownership check', async () => {
      paymentsService.findById.mockResolvedValue(paymentEntity as never);

      await resolver.payment('pay-1', 'admin-1', 'admin');

      expect(paymentsService.findById).toHaveBeenCalledWith('pay-1', undefined);
    });
  });

  describe('paymentByOrderId', () => {
    it('is decorated with @Public()', () => {
      const paymentByOrderIdMethod = Object.getOwnPropertyDescriptor(
        PaymentsResolver.prototype,
        'paymentByOrderId',
      )?.value as (...args: unknown[]) => unknown;
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, paymentByOrderIdMethod) as
        boolean | undefined;
      expect(isPublic).toBe(true);
    });

    it('returns latest payment mapped to PaymentType', async () => {
      paymentsService.findLatestByOrderId.mockResolvedValue({
        ...paymentEntity,
        status: 'paid',
      } as never);

      const result = await resolver.paymentByOrderId('ord-1', undefined, undefined);

      expect(paymentsService.findLatestByOrderId).toHaveBeenCalledWith('ord-1', undefined);
      expect(result.status).toBe('paid');
      expect(result.orderId).toBe('ord-1');
    });
  });
});
