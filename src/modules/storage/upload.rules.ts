import type { UploadFolder } from './storage.inputs';

export interface AspectRatioRule {
  width: number;
  height: number;
  tolerance: number;
}

export interface FolderUploadRules {
  maxSizeBytes: number;
  allowedMimeTypes: readonly string[];
  aspectRatio?: AspectRatioRule;
}

const MB = 1024 * 1024;

const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

const ADS_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'] as const;

const DEFAULT_RULES: FolderUploadRules = {
  maxSizeBytes: 5 * MB,
  allowedMimeTypes: DEFAULT_ALLOWED_MIME_TYPES,
};

export const FOLDER_UPLOAD_RULES: Record<UploadFolder, FolderUploadRules> = {
  products: DEFAULT_RULES,
  stores: DEFAULT_RULES,
  reviews: DEFAULT_RULES,
  profiles: DEFAULT_RULES,
  banners: DEFAULT_RULES,
  sponsors: DEFAULT_RULES,
  categories: DEFAULT_RULES,
  ads: {
    maxSizeBytes: 1 * MB,
    allowedMimeTypes: ADS_ALLOWED_MIME_TYPES,
    aspectRatio: { width: 4, height: 5, tolerance: 0.02 },
  },
};

export function getFolderUploadRules(folder: UploadFolder): FolderUploadRules {
  return FOLDER_UPLOAD_RULES[folder];
}

export function isAspectRatioWithinTolerance(
  width: number,
  height: number,
  rule: AspectRatioRule,
): boolean {
  const expected = rule.width / rule.height;
  const actual = width / height;
  return Math.abs(actual - expected) / expected <= rule.tolerance;
}
