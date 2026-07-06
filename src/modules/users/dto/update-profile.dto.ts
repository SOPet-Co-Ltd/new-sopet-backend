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
}
