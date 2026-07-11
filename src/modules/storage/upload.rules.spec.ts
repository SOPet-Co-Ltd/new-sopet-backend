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
});
