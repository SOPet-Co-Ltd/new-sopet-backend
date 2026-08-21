import { UPLOAD_FOLDERS, type UploadFolder } from './storage.inputs';

export const CUSTOMER_UPLOAD_FOLDERS: readonly UploadFolder[] = ['profiles', 'reviews'];
export const VENDOR_UPLOAD_FOLDERS: readonly UploadFolder[] = ['products', 'stores', 'reviews'];

export function foldersAllowedForRole(role: string | undefined): readonly UploadFolder[] {
  if (role === 'admin') {
    return UPLOAD_FOLDERS;
  }
  if (role === 'vendor') {
    return VENDOR_UPLOAD_FOLDERS;
  }
  if (role === 'customer') {
    return CUSTOMER_UPLOAD_FOLDERS;
  }
  return [];
}
