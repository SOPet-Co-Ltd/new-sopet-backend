import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { type ObjectCannedACL, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getFolderUploadRules, isAspectRatioWithinTolerance } from './upload.rules';
import type { UploadFolder } from './storage.inputs';

export interface UploadResult {
  url: string;
  key: string;
}

interface ResolvedStorageSettings {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle: boolean;
  publicUrl: string;
  acl?: string;
}

@Injectable()
export class StorageService {
  private client?: S3Client;
  private settings?: ResolvedStorageSettings;

  constructor(private readonly configService: ConfigService) {}

  async uploadFile(buffer: Buffer, key: string, contentType: string): Promise<UploadResult> {
    const settings = this.getSettings();
    const client = this.getClient(settings);

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: settings.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ContentLength: buffer.length,
          ...(settings.acl ? { ACL: settings.acl as ObjectCannedACL } : {}),
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BadRequestException({
        code: 'UPLOAD_FAILED',
        message: `Failed to upload file: ${detail}`,
      });
    }

    return {
      url: this.buildPublicUrl(settings, key),
      key,
    };
  }

  buildObjectKey(folder: string, contentType: string): string {
    const extension = this.extensionFromContentType(contentType);
    return `${folder}/${randomUUID()}.${extension}`;
  }

  async convertToWebp(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer, { failOn: 'none' }).rotate().webp({ quality: 85 }).toBuffer();
  }

  async validateImageUpload(
    buffer: Buffer,
    contentType: string,
    folder: UploadFolder,
  ): Promise<void> {
    const rules = getFolderUploadRules(folder);
    const mime = contentType.toLowerCase();

    if (!rules.allowedMimeTypes.includes(mime)) {
      throw new BadRequestException({
        code: 'INVALID_IMAGE_TYPE',
        message: `Image type not allowed for folder "${folder}"`,
      });
    }

    if (buffer.length > rules.maxSizeBytes) {
      throw new BadRequestException({
        code: 'IMAGE_TOO_LARGE',
        message: `Image exceeds maximum size for folder "${folder}"`,
      });
    }

    if (rules.aspectRatio) {
      const metadata = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
      const { width, height } = metadata;

      if (!width || !height) {
        throw new BadRequestException({
          code: 'INVALID_IMAGE',
          message: 'Unable to read image dimensions',
        });
      }

      if (!isAspectRatioWithinTolerance(width, height, rules.aspectRatio)) {
        throw new BadRequestException({
          code: 'INVALID_ASPECT_RATIO',
          message: `Image aspect ratio must be ${rules.aspectRatio.width}:${rules.aspectRatio.height}`,
        });
      }
    }
  }

  decodeBase64Image(base64: string): { buffer: Buffer; contentType: string } {
    const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(base64.trim());
    if (dataUrlMatch) {
      return {
        contentType: dataUrlMatch[1],
        buffer: Buffer.from(dataUrlMatch[2], 'base64'),
      };
    }

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) {
      throw new BadRequestException({
        code: 'INVALID_BASE64',
        message: 'Invalid base64 image data',
      });
    }

    return {
      contentType: 'image/jpeg',
      buffer,
    };
  }

  private getSettings(): ResolvedStorageSettings {
    if (this.settings) {
      return this.settings;
    }

    const provider = this.configService.get<string>('storage.provider') || 's3';

    let resolved: ResolvedStorageSettings;

    if (provider === 'r2') {
      const r2 = this.configService.get<{
        accountId: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucket: string;
      }>('storage.cloudflareR2');
      const cdnUrl = this.configService.get<string>('storage.cdnUrl') || '';

      resolved = {
        accessKeyId: r2?.accessKeyId || '',
        secretAccessKey: r2?.secretAccessKey || '',
        region: 'auto',
        bucket: r2?.bucket || '',
        endpoint: r2?.accountId ? `https://${r2.accountId}.r2.cloudflarestorage.com` : undefined,
        forcePathStyle: false,
        publicUrl: cdnUrl,
      };
    } else {
      const s3 = this.configService.get<{
        accessKeyId: string;
        secretAccessKey: string;
        region: string;
        bucket: string;
        endpoint?: string;
        forcePathStyle: boolean;
        publicUrl: string;
        objectAcl?: string;
      }>('storage.s3');

      resolved = {
        accessKeyId: s3?.accessKeyId || '',
        secretAccessKey: s3?.secretAccessKey || '',
        region: s3?.region || 'ap-southeast-1',
        bucket: s3?.bucket || '',
        endpoint: s3?.endpoint || undefined,
        forcePathStyle: Boolean(s3?.forcePathStyle),
        publicUrl: s3?.publicUrl || '',
        acl: s3?.objectAcl || undefined,
      };
    }

    if (!resolved.bucket || !resolved.accessKeyId || !resolved.secretAccessKey) {
      throw new BadRequestException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'Object storage is not configured',
      });
    }

    this.settings = resolved;
    return resolved;
  }

  private getClient(settings: ResolvedStorageSettings): S3Client {
    if (this.client) {
      return this.client;
    }

    this.client = new S3Client({
      region: settings.region,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      forcePathStyle: settings.forcePathStyle,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    });

    return this.client;
  }

  private buildPublicUrl(
    settings: { bucket: string; endpoint?: string; publicUrl: string },
    key: string,
  ): string {
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    if (settings.publicUrl) {
      return `${settings.publicUrl.replace(/\/$/, '')}/${encodedKey}`;
    }

    if (settings.endpoint) {
      const base = settings.endpoint.replace(/\/$/, '');
      return `${base}/${settings.bucket}/${encodedKey}`;
    }

    return `https://${settings.bucket}.s3.amazonaws.com/${encodedKey}`;
  }

  private extensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    return map[contentType.toLowerCase()] ?? 'jpg';
  }
}
