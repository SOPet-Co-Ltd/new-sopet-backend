import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePublicReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Review image source URLs. The server downloads each URL, validates (jpeg/png/webp/gif, max 5 MB), converts to WebP, stores in the object bucket, and persists only the storage URL — source URLs are never saved. Max 5 images. Any download/validation failure fails the whole create.',
    example: ['https://cdn.example.com/review-1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { each: true })
  images?: string[];
}
