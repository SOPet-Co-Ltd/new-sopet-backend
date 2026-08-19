import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StorageResolver } from './storage.resolver';
import { StorageService } from './storage.service';

describe('StorageResolver uploadImage', () => {
  const storageService = {
    decodeBase64Image: jest.fn().mockReturnValue({
      buffer: Buffer.from('test'),
      contentType: 'image/png',
    }),
    validateImageUpload: jest.fn().mockResolvedValue(undefined),
    convertToWebp: jest.fn().mockResolvedValue(Buffer.from('webp')),
    buildObjectKey: jest.fn().mockReturnValue('products/key.webp'),
    uploadFile: jest.fn().mockResolvedValue({ url: 'https://cdn.example/key.webp', key: 'key' }),
  };

  const resolver = new StorageResolver(storageService as unknown as StorageService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows customers to upload to products folder', async () => {
    const result = await resolver.uploadImage('data:image/png;base64,abc', 'products', 'customer');
    expect(result.url).toBe('https://cdn.example/key.webp');
  });

  it('allows customers to upload to profiles folder', async () => {
    await resolver.uploadImage('data:image/png;base64,abc', 'profiles', 'customer');
    expect(storageService.buildObjectKey).toHaveBeenCalledWith('profiles', 'image/webp');
  });

  it('rejects customer uploads to privileged folders', async () => {
    await expect(
      resolver.uploadImage('data:image/png;base64,abc', 'banners', 'customer'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows vendor uploads to banners folder', async () => {
    await resolver.uploadImage('data:image/png;base64,abc', 'banners', 'vendor');
    expect(storageService.validateImageUpload).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      'banners',
    );
  });

  it('rejects unknown folders', async () => {
    await expect(
      resolver.uploadImage('data:image/png;base64,abc', 'admin', 'vendor'),
    ).rejects.toThrow(BadRequestException);
  });
});
