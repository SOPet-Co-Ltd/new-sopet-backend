import { UPLOAD_FOLDERS } from './storage.inputs';
import { foldersAllowedForRole } from './upload-folder-acl';

describe('uploadImage folder ACL (SOPET-H-05)', () => {
  it('allows customer profiles/reviews only', () => {
    expect(foldersAllowedForRole('customer')).toEqual(['profiles', 'reviews']);
    expect(foldersAllowedForRole('customer')).not.toContain('banners');
    expect(foldersAllowedForRole('customer')).not.toContain('products');
  });

  it('allows vendor products/stores/reviews only', () => {
    expect(foldersAllowedForRole('vendor')).toEqual(['products', 'stores', 'reviews']);
    expect(foldersAllowedForRole('vendor')).not.toContain('ads');
    expect(foldersAllowedForRole('vendor')).not.toContain('login-images');
  });

  it('allows admin all UPLOAD_FOLDERS', () => {
    expect(foldersAllowedForRole('admin')).toEqual([...UPLOAD_FOLDERS]);
  });

  it('denies unknown roles', () => {
    expect(foldersAllowedForRole(undefined)).toEqual([]);
    expect(foldersAllowedForRole('guest')).toEqual([]);
  });
});
