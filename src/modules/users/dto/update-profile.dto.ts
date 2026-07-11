import { IsOptional, IsString, IsEmail, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Customer full name',
    example: 'Somchai Jaidee',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Customer email address',
    example: 'somchai@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Customer profile photo URL',
    example: 'https://cdn.example.com/profiles/abc.webp',
  })
  @IsOptional()
  @IsString()
  profilePhotoUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Customer date of birth (YYYY-MM-DD)',
    example: '1990-05-15',
  })
  @IsOptional()
  @IsString()
  dateOfBirth?: string | null;
}
