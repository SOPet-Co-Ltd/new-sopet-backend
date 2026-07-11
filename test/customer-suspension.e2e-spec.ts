import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  createAuthServiceTestMocks,
  createAuthServiceTestProviders,
} from '../src/modules/auth/auth-service.test-providers';

describe('Customer suspension (e2e)', () => {
  let authService: AuthService;
  let mocks: ReturnType<typeof createAuthServiceTestMocks>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mocks = createAuthServiceTestMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: createAuthServiceTestProviders(mocks),
    }).compile();

    authService = module.get(AuthService);
  });

  it('verifyOtp returns CUSTOMER_SUSPENDED for inactive customer', async () => {
    mocks.otpRepo.findOne.mockResolvedValue({
      phone: '+66812345678',
      code: '123456',
      isUsed: false,
    });
    mocks.customerRepoWrapper.findActiveByPhone.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: false,
      deletionRequestedAt: null,
    });

    await expect(
      authService.verifyOtp({ phone: '+66812345678', code: '123456' }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_SUSPENDED' },
    });
    expect(mocks.cartService.mergeGuestCart).not.toHaveBeenCalled();
  });

  it('verifyOtp succeeds for active customer', async () => {
    mocks.otpRepo.findOne.mockResolvedValue({
      phone: '+66812345678',
      code: '654321',
      isUsed: false,
    });
    mocks.customerRepoWrapper.findActiveByPhone.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: true,
    });

    const result = await authService.verifyOtp({
      phone: '+66812345678',
      code: '654321',
      sessionId: 'guest-session',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(mocks.cartService.mergeGuestCart).toHaveBeenCalledWith('cust-1', 'guest-session');
    expect(mocks.guestOrderLinkService.mergeGuestOrders).toHaveBeenCalledWith(
      'cust-1',
      '0812345678',
    );
  });

  it('verifyOtp throws ForbiddenException for suspended customer', async () => {
    mocks.otpRepo.findOne.mockResolvedValue({
      phone: '+66812345678',
      code: '123456',
      isUsed: false,
    });
    mocks.customerRepoWrapper.findActiveByPhone.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: false,
      deletionRequestedAt: null,
    });

    await expect(authService.verifyOtp({ phone: '+66812345678', code: '123456' })).rejects.toThrow(
      ForbiddenException,
    );
  });
});
