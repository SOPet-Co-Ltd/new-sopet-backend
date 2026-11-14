import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { BeamWebhookRetryableError } from './beam-webhook-retryable.error';
import { PaymentsService } from './payments.service';

describe('PaymentsWebhookController handleBeamWebhook', () => {
  let controller: PaymentsWebhookController;
  const paymentsService = {
    verifyBeamWebhookSignature: jest.fn(),
    handleBeamWebhook: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    paymentsService.verifyBeamWebhookSignature.mockReturnValue(true);
    paymentsService.handleBeamWebhook.mockResolvedValue(undefined);
    controller = new PaymentsWebhookController(paymentsService as unknown as PaymentsService);
  });

  function req(overrides?: { rawBody?: Buffer | undefined; signature?: string; event?: string }) {
    return {
      rawBody: overrides && 'rawBody' in overrides ? overrides.rawBody : Buffer.from('{}'),
      headers: {
        'x-beam-signature': overrides?.signature ?? 'sig',
        'x-beam-event': overrides?.event ?? 'charge.succeeded',
      },
    } as never;
  }

  it('returns 200 received when service completes a durable result', async () => {
    const result = await controller.handleBeamWebhook(req(), { chargeId: 'ch_1' });

    expect(result).toEqual({ received: true });
    expect(paymentsService.handleBeamWebhook).toHaveBeenCalledWith(
      { chargeId: 'ch_1' },
      'charge.succeeded',
    );
  });

  it('returns 200 ignored for unknown events without calling the service', async () => {
    const result = await controller.handleBeamWebhook(req({ event: 'charge.updated' }), {});

    expect(result).toEqual({ received: true, ignored: true });
    expect(paymentsService.handleBeamWebhook).not.toHaveBeenCalled();
  });

  it('throws 401 for a bad signature', async () => {
    paymentsService.verifyBeamWebhookSignature.mockReturnValue(false);

    await expect(controller.handleBeamWebhook(req(), {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(paymentsService.handleBeamWebhook).not.toHaveBeenCalled();
  });

  it('throws 400 when raw body is missing', async () => {
    await expect(
      controller.handleBeamWebhook(req({ rawBody: undefined }), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps BeamWebhookRetryableError to 503 and does not return received', async () => {
    paymentsService.handleBeamWebhook.mockRejectedValue(
      new BeamWebhookRetryableError('No order/payment for Beam charge ch_1'),
    );

    await expect(controller.handleBeamWebhook(req(), { chargeId: 'ch_1' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('returns 200 for amount mismatch (service resolves without throw)', async () => {
    paymentsService.handleBeamWebhook.mockResolvedValue(undefined);

    const result = await controller.handleBeamWebhook(req(), { chargeId: 'ch_mismatch' });

    expect(result).toEqual({ received: true });
  });

  it('returns 200 for already paid / cancelled / refunded (service no-ops)', async () => {
    paymentsService.handleBeamWebhook.mockResolvedValue(undefined);

    await expect(controller.handleBeamWebhook(req(), { chargeId: 'ch_paid' })).resolves.toEqual({
      received: true,
    });
  });
});
