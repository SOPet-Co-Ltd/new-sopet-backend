import { UPLOAD_FOLDERS } from './storage.inputs';
import { FOLDER_UPLOAD_RULES, getFolderUploadRules } from './upload.rules';

const MB = 1024 * 1024;

describe('upload.rules', () => {
  it('includes expected upload folders', () => {
    expect(UPLOAD_FOLDERS).toContain('products');
    expect(UPLOAD_FOLDERS).not.toContain('disputes');
  });

  it('defines default rules for products folder', () => {
    const rules = getFolderUploadRules('products');
    expect(rules.maxSizeBytes).toBe(5 * MB);
    expect(FOLDER_UPLOAD_RULES.products).toBe(rules);
  });

  it('allows login-images with DEFAULT_RULES only (no ads aspect)', () => {
    expect(UPLOAD_FOLDERS).toContain('login-images');

    const rules = getFolderUploadRules('login-images');
    expect(rules.maxSizeBytes).toBe(5 * MB);
    expect(rules.allowedMimeTypes).toEqual([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
    expect(rules.aspectRatio).toBeUndefined();
    expect(FOLDER_UPLOAD_RULES['login-images']).toBe(FOLDER_UPLOAD_RULES.banners);
  });

  it('keeps ads aspect rules unchanged', () => {
    const ads = getFolderUploadRules('ads');
    expect(ads.maxSizeBytes).toBe(1 * MB);
    expect(ads.aspectRatio).toEqual({ width: 4, height: 5, tolerance: 0.02 });
  });
});
