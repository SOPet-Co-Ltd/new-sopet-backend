import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { StorageService } from './storage.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3Config = {
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  region: 'ap-southeast-1',
  bucket: 'sopet-ecommerce-files',
  endpoint: 'http://localhost:9000',
  forcePathStyle: true,
  publicUrl: 'http://localhost:9000/sopet-ecommerce-files',
  objectAcl: '',
};

const buildConfigGet =
  (overrides: { s3?: Record<string, unknown>; provider?: string } = {}) =>
  (path: string) => {
    switch (path) {
      case 'storage.provider':
        return overrides.provider ?? 's3';
      case 'storage.s3':
        return { ...s3Config, ...(overrides.s3 ?? {}) };
      case 'storage.cloudflareR2':
        return {
          accountId: 'acct',
          accessKeyId: 'r2-key',
          secretAccessKey: 'r2-secret',
          bucket: 'r2-bucket',
        };
      case 'storage.cdnUrl':
        return 'https://cdn.example.com';
      default:
        return undefined;
    }
  };

const createService = async (get: (path: string) => unknown) => {
  const module = await Test.createTestingModule({
    providers: [StorageService, { provide: ConfigService, useValue: { get: jest.fn(get) } }],
  }).compile();
  return module.get(StorageService);
};

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    mockSend.mockReset().mockResolvedValue({});
    (S3Client as jest.Mock).mockClear();
    (PutObjectCommand as jest.Mock).mockClear();
    service = await createService(buildConfigGet());
  });

  it('converts PNG input to WebP output', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const input = Buffer.from(pngBase64, 'base64');

    const webp = await service.convertToWebp(input);

    expect(webp.length).toBeGreaterThan(0);
    expect(webp.subarray(0, 4).toString()).toBe('RIFF');
    expect(webp.subarray(8, 12).toString()).toBe('WEBP');
  });

  it('builds webp object keys for webp content type', () => {
    const key = service.buildObjectKey('products', 'image/webp');
    expect(key).toMatch(/^products\/[0-9a-f-]+\.webp$/);
  });

  it('uploads via PutObjectCommand and returns the public URL', async () => {
    const buffer = Buffer.from('webp-bytes');
    const result = await service.uploadFile(buffer, 'products/abc.webp', 'image/webp');

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'ap-southeast-1',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        credentials: {
          accessKeyId: 'minioadmin',
          secretAccessKey: 'minioadmin',
        },
      }),
    );
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'sopet-ecommerce-files',
        Key: 'products/abc.webp',
        ContentType: 'image/webp',
        Body: buffer,
      }),
    );
    // No ACL by default (bucket policy handles public read).
    expect((PutObjectCommand as jest.Mock).mock.calls[0][0].ACL).toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      url: 'http://localhost:9000/sopet-ecommerce-files/products/abc.webp',
      key: 'products/abc.webp',
    });
  });

  it('sets a canned ACL only when configured', async () => {
    const withAcl = await createService(buildConfigGet({ s3: { objectAcl: 'public-read' } }));
    await withAcl.uploadFile(Buffer.from('x'), 'products/a.webp', 'image/webp');
    expect((PutObjectCommand as jest.Mock).mock.calls[0][0].ACL).toBe('public-read');
  });

  it('throws STORAGE_NOT_CONFIGURED when credentials are missing', async () => {
    const unconfigured = await createService(
      buildConfigGet({ s3: { accessKeyId: '', secretAccessKey: '' } }),
    );
    await expect(
      unconfigured.uploadFile(Buffer.from('x'), 'products/a.webp', 'image/webp'),
    ).rejects.toMatchObject({
      response: { code: 'STORAGE_NOT_CONFIGURED' },
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('surfaces a clean UPLOAD_FAILED error when the client rejects', async () => {
    mockSend.mockRejectedValueOnce(new Error('connection refused'));
    await expect(
      service.uploadFile(Buffer.from('x'), 'products/a.webp', 'image/webp'),
    ).rejects.toMatchObject({
      response: {
        code: 'UPLOAD_FAILED',
        message: 'Failed to upload file: connection refused',
      },
    });
  });

  describe('validateImageUpload', () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    it('rejects disallowed mime types for ads folder', async () => {
      const buffer = Buffer.from(pngBase64, 'base64');
      await expect(service.validateImageUpload(buffer, 'image/gif', 'ads')).rejects.toMatchObject({
        response: { code: 'INVALID_IMAGE_TYPE' },
      });
    });

    it('rejects files larger than 1 MB for ads folder', async () => {
      const buffer = Buffer.alloc(1 * 1024 * 1024 + 1);
      await expect(service.validateImageUpload(buffer, 'image/png', 'ads')).rejects.toMatchObject({
        response: { code: 'IMAGE_TOO_LARGE' },
      });
    });

    it('rejects invalid aspect ratio for ads folder', async () => {
      const buffer = Buffer.from(pngBase64, 'base64');
      await expect(service.validateImageUpload(buffer, 'image/png', 'ads')).rejects.toMatchObject({
        response: { code: 'INVALID_ASPECT_RATIO' },
      });
    });

    it('allows valid 4:5 png for ads folder', async () => {
      const buffer = await sharp({
        create: {
          width: 400,
          height: 500,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      await expect(
        service.validateImageUpload(buffer, 'image/png', 'ads'),
      ).resolves.toBeUndefined();
    });
  });
});
