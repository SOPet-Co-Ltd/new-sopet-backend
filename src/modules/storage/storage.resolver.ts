import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UPLOAD_FOLDERS, type UploadFolder } from './storage.inputs';
import { UploadResultType } from '../../graphql/models/types';
import { Roles } from '../../common/decorators';
import { AllowSuspendedStore } from '../../common/decorators/allow-suspended-store.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Resolver()
export class StorageResolver {
  constructor(private readonly storageService: StorageService) {}

  @Mutation(() => UploadResultType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin', 'customer')
  @AllowSuspendedStore()
  async uploadImage(
    @Args('base64') base64: string,
    @Args('folder', { nullable: true }) folder?: string,
  ): Promise<UploadResultType> {
    const resolvedFolder = folder ?? 'products';
    if (!UPLOAD_FOLDERS.includes(resolvedFolder as (typeof UPLOAD_FOLDERS)[number])) {
      throw new BadRequestException({
        code: 'INVALID_FOLDER',
        message: `Folder must be one of: ${UPLOAD_FOLDERS.join(', ')}`,
      });
    }

    const { buffer, contentType } = this.storageService.decodeBase64Image(base64);
    await this.storageService.validateImageUpload(
      buffer,
      contentType,
      resolvedFolder as UploadFolder,
    );
    const webpBuffer = await this.storageService.convertToWebp(buffer);
    const webpContentType = 'image/webp';
    const key = this.storageService.buildObjectKey(resolvedFolder, webpContentType);
    return this.storageService.uploadFile(webpBuffer, key, webpContentType);
  }
}
