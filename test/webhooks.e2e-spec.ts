import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import omiseConfig from '../src/config/omise.config';
import { PaymentsWebhookController } from '../src/modules/payments/payments-webhook.controller';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { Payment } from '../src/database/entities/payment.entity';
import { Order } from '../src/database/entities/order.entity';
import { SavedPaymentMethod } from '../src/database/entities/saved-payment-method.entity';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { computeOmiseWebhookSignature } from '../src/modules/payments/omise-webhook.util';

describe('Omise webhook (e2e)', () => {
  let app: INestApplication<App>;
  const secretB64 = randomBytes(32).toString('base64');
  const paymentRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const orderRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const notifications = {
    notifyOrderPaid: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.OMISE_WEBHOOK_SECRET = secretB64;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [omiseConfig],
        }),
      ],
      controllers: [PaymentsWebhookController],
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(SavedPaymentMethod), useValue: { findOne: jest.fn() } },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    delete process.env.OMISE_WEBHOOK_SECRET;
    if (app) {
      await app.close();
    }
  });

  function signedRequest(body: Record<string, unknown>) {
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = computeOmiseWebhookSignature(rawBody, timestamp, secretB64);

    return request(app.getHttpServer())
      .post('/webhooks/omise')
      .set('Content-Type', 'application/json')
      .set('Omise-Signature', signature)
      .set('Omise-Signature-Timestamp', timestamp)
      .send(rawBody);
  }

  it('returns 200 for valid signed payload', async () => {
    orderRepo.findOne.mockResolvedValue(null);

    await signedRequest({
      key: 'charge.complete',
      data: { id: 'chrg_e2e', status: 'successful' },
    })
      .expect(200)
      .expect({ received: true });
  });

  it('returns 401 for invalid signature', async () => {
    const rawBody = JSON.stringify({
      key: 'charge.complete',
      data: { id: 'chrg_bad', status: 'successful' },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));

    await request(app.getHttpServer())
      .post('/webhooks/omise')
      .set('Content-Type', 'application/json')
      .set('Omise-Signature', 'invalid')
      .set('Omise-Signature-Timestamp', timestamp)
      .send(rawBody)
      .expect(401);
  });
});
