import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveStoreDto {
  @ApiProperty({
    description: 'ID of the admin approving the store',
    example: 'admin-0000-0000-0000-000000000000',
  })
  @IsNotEmpty()
  @IsString()
  adminId!: string;
}

export class RejectStoreDto {
  @ApiProperty({
    description: 'ID of the admin rejecting the store',
    example: 'admin-0000-0000-0000-000000000000',
  })
  @IsNotEmpty()
  @IsString()
  adminId!: string;

  @ApiPropertyOptional({
    description: 'Reason the store application was rejected',
    example: 'Incomplete bank details.',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
