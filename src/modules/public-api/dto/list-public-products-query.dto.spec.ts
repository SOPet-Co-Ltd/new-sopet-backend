import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../../common/pipes/validation.pipe';
import { ProductStatus } from '../../../database/entities/product.entity';
import { ListPublicProductsQueryDto } from './list-public-products-query.dto';

describe('ListPublicProductsQueryDto', () => {
  const validationPipe = new ValidationPipe();
  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: ListPublicProductsQueryDto,
      type: 'query',
    } as never);

  it('accepts empty query and keeps defaults on the class', async () => {
    const result = (await validate({})) as ListPublicProductsQueryDto;
    expect(result).toBeInstanceOf(ListPublicProductsQueryDto);
  });

  it('coerces page and limit query strings to numbers', async () => {
    const result = (await validate({ page: '2', limit: '50' })) as ListPublicProductsQueryDto;
    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);
  });

  it('accepts status and search filters', async () => {
    const result = (await validate({
      status: ProductStatus.DRAFT,
      search: 'แมว',
    })) as ListPublicProductsQueryDto;
    expect(result.status).toBe(ProductStatus.DRAFT);
    expect(result.search).toBe('แมว');
  });

  it('rejects page < 1', async () => {
    await expect(validate({ page: '0' })).rejects.toThrow(BadRequestException);
  });

  it('rejects limit > 100', async () => {
    await expect(validate({ limit: '101' })).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid status', async () => {
    await expect(validate({ status: 'deleted' })).rejects.toThrow(BadRequestException);
  });
});
