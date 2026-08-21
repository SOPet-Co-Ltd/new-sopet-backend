import { BadRequestException } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { ValidationPipe } from './validation.pipe';

class SampleDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

describe('ValidationPipe', () => {
  const pipe = new ValidationPipe();

  it('strips and rejects non-whitelisted properties', async () => {
    await expect(
      pipe.transform({ name: 'ok', extra: 'nope' }, { metatype: SampleDto, type: 'body' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts valid payloads', async () => {
    const result = await pipe.transform({ name: 'ok' }, {
      metatype: SampleDto,
      type: 'body',
    } as never);
    expect(result).toEqual({ name: 'ok' });
  });
});
