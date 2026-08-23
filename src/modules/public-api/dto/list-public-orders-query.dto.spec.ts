import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../../common/pipes/validation.pipe';
import { OrderStatus } from '../../../database/entities/order.entity';
import { FulfillmentStatus } from '../../../database/entities/order-item.entity';
import { ListPublicOrdersQueryDto } from './list-public-orders-query.dto';

describe('ListPublicOrdersQueryDto', () => {
  const validationPipe = new ValidationPipe();
  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: ListPublicOrdersQueryDto,
      type: 'query',
    } as never);

  it('accepts empty query', async () => {
    const result = (await validate({})) as ListPublicOrdersQueryDto;
    expect(result).toBeInstanceOf(ListPublicOrdersQueryDto);
  });

  it('coerces page/limit and accepts filters', async () => {
    const result = (await validate({
      page: '2',
      limit: '50',
      status: OrderStatus.PAID,
      fulfillmentStatus: FulfillmentStatus.PENDING,
      updatedSince: '2026-08-23T00:00:00.000Z',
      createdSince: '2026-08-01T00:00:00.000Z',
      createdUntil: '2026-08-23T23:59:59.000Z',
    })) as ListPublicOrdersQueryDto;

    expect(result.page).toBe(2);
    expect(result.limit).toBe(50);
    expect(result.status).toBe(OrderStatus.PAID);
    expect(result.fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
    expect(result.updatedSince).toBe('2026-08-23T00:00:00.000Z');
  });

  it('rejects invalid status', async () => {
    await expect(validate({ status: 'unknown' })).rejects.toThrow(BadRequestException);
  });

  it('rejects invalid date', async () => {
    await expect(validate({ updatedSince: 'not-a-date' })).rejects.toThrow(BadRequestException);
  });

  it('rejects limit > 100', async () => {
    await expect(validate({ limit: '101' })).rejects.toThrow(BadRequestException);
  });
});
