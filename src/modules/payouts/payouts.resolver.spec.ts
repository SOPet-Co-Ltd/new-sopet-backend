import { Test, TestingModule } from '@nestjs/testing';
import {
  encryptBankAccountNumber,
  decryptBankAccountNumber,
} from '../../common/utils/bank-account-crypto.util';
import { BankAccountVerificationStatus } from '../../database/entities/store.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { StoresService } from '../stores/stores.service';
import { PayoutsResolver } from './payouts.resolver';
import { PayoutsService } from './payouts.service';

describe('PayoutsResolver pendingManualPayouts', () => {
  const previousKey = process.env.BANK_DATA_ENCRYPTION_KEY;
  let resolver: PayoutsResolver;
  const payoutsService = {
    findPendingManualPayouts: jest.fn(),
  };

  beforeAll(() => {
    process.env.BANK_DATA_ENCRYPTION_KEY = 'test-bank-encryption-key-for-payout-queue';
  });

  afterAll(() => {
    if (previousKey === undefined) {
      delete process.env.BANK_DATA_ENCRYPTION_KEY;
    } else {
      process.env.BANK_DATA_ENCRYPTION_KEY = previousKey;
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsResolver,
        { provide: PayoutsService, useValue: payoutsService },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        { provide: StoresService, useValue: { assertStoreOwner: jest.fn() } },
      ],
    }).compile();

    resolver = module.get(PayoutsResolver);
  });

  it('decrypts encrypted bank account numbers and returns verification status', async () => {
    const encrypted = encryptBankAccountNumber('1234567890');
    expect(encrypted?.startsWith('enc:v1:')).toBe(true);

    payoutsService.findPendingManualPayouts.mockResolvedValue({
      items: [
        {
          id: 'payout-1',
          storeId: 'store-1',
          amount: 1500,
          netAmount: 1500,
          productSold: 1500,
          shippingFees: 0,
          commissionAmount: 0,
          commissionRate: 7,
          status: 'pending',
          settlementRail: 'manual',
          notes: 'Vendor requested payout',
          failureReason: null,
          processedAt: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          store: {
            name: 'Pet Shop',
            bankName: 'Kasikornbank',
            bankCode: '004',
            bankAccountName: 'Pet Shop Co',
            bankAccountNumber: encrypted,
            bankAccountVerificationStatus: BankAccountVerificationStatus.VERIFIED,
          },
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await resolver.pendingManualPayouts(1, 20);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].bankAccountNumber).toBe('1234567890');
    expect(result.items[0].bankAccountNumber).toBe(decryptBankAccountNumber(encrypted));
    expect(result.items[0].bankAccountVerificationStatus).toBe(
      BankAccountVerificationStatus.VERIFIED,
    );
    expect(result.items[0].notes).toBe('Vendor requested payout');
  });
});
