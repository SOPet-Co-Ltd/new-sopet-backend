import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';

describe('SmsService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(config: Record<string, unknown>): SmsService {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    return new SmsService(configService);
  }

  it('logs OTP in development without calling providers', async () => {
    const service = createService({
      'app.environment': 'development',
      'thaibulksms.otpLogOnly': false,
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await service.sendOtp('0812345678', '123456');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs OTP when SMS_OTP_LOG_ONLY is enabled', async () => {
    const service = createService({
      'app.environment': 'production',
      'thaibulksms.otpLogOnly': true,
      'thaibulksms.apiKey': 'key',
      'thaibulksms.apiSecret': 'secret',
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await service.sendOtp('0812345678', '123456');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws SMS_NOT_CONFIGURED when no provider credentials are set', async () => {
    const service = createService({
      'app.environment': 'production',
      'thaibulksms.otpLogOnly': false,
      'thaibulksms.apiKey': '',
      'thaibulksms.apiSecret': '',
      'twilio.accountSid': '',
      'twilio.authToken': '',
      'twilio.phoneNumber': '',
    });

    await expect(service.sendOtp('0812345678', '123456')).rejects.toMatchObject({
      response: {
        code: 'SMS_NOT_CONFIGURED',
      },
    });
  });

  it('sends ThaiBulkSMS as application/x-www-form-urlencoded', async () => {
    const service = createService({
      'app.environment': 'production',
      'thaibulksms.otpLogOnly': false,
      'thaibulksms.apiKey': 'api-key',
      'thaibulksms.apiSecret': 'api-secret',
      'thaibulksms.sender': 'SOPet',
      'thaibulksms.force': 'corporate',
      'thaibulksms.shortenUrl': false,
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          phone_number_list: [{ number: '66812345678', message_id: 'msg-1', used_credit: 1 }],
        }),
    });
    global.fetch = fetchMock;

    await service.sendOtp('0812345678', '123456');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-v2.thaibulksms.com/sms',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: 'msisdn=0812345678&message=Your+SOPet+verification+code+is+123456.+Valid+for+5+minutes.&sender=SOPet&force=corporate&shorten_url=false',
      }),
    );
  });

  it('throws SMS_DELIVERY_FAILED when ThaiBulkSMS returns non-OK status', async () => {
    const service = createService({
      'app.environment': 'production',
      'thaibulksms.otpLogOnly': false,
      'thaibulksms.apiKey': 'api-key',
      'thaibulksms.apiSecret': 'api-secret',
      'thaibulksms.sender': 'SOPet',
      'thaibulksms.force': 'corporate',
      'thaibulksms.shortenUrl': false,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'ERROR_FORCE' }),
    });

    await expect(service.sendOtp('0812345678', '123456')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.sendOtp('0812345678', '123456')).rejects.toMatchObject({
      response: {
        code: 'SMS_DELIVERY_FAILED',
      },
    });
  });

  it('throws INVALID_PHONE when ThaiBulkSMS rejects the number', async () => {
    const service = createService({
      'app.environment': 'production',
      'thaibulksms.otpLogOnly': false,
      'thaibulksms.apiKey': 'api-key',
      'thaibulksms.apiSecret': 'api-secret',
      'thaibulksms.sender': 'SOPet',
      'thaibulksms.force': 'corporate',
      'thaibulksms.shortenUrl': false,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          bad_phone_number_list: [{ number: '0812345678', message: 'Phone number is invalid.' }],
        }),
    });

    await expect(service.sendOtp('0812345678', '123456')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.sendOtp('0812345678', '123456')).rejects.toMatchObject({
      response: {
        code: 'INVALID_PHONE',
      },
    });
  });
});
