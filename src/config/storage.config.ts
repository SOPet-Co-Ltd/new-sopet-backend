import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'ap-southeast-1',
    bucket: process.env.AWS_S3_BUCKET || '',
    endpoint: process.env.AWS_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    publicUrl: process.env.AWS_S3_PUBLIC_URL || '',
    // Optional canned ACL (e.g. 'public-read'). Leave empty when the bucket
    // grants public read via a bucket policy (recommended for MinIO/R2).
    objectAcl: process.env.AWS_S3_OBJECT_ACL || '',
  },
  cloudflareR2: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY || '',
    bucket: process.env.CLOUDFLARE_R2_BUCKET || '',
  },
  provider: process.env.STORAGE_PROVIDER || 's3', // 's3' or 'r2'
  cdnUrl: process.env.CDN_URL || '',
}));
