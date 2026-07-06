import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { StoreStatusGuard } from '../src/modules/auth/guards/store-status.guard';
import { Store, StoreStatus } from '../src/database/entities/store.entity';
import { ValidationPipe } from '../src/common/pipes/validation.pipe';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

@Injectable()
class MockVendorUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { id: 'user-1', role: 'vendor', storeId: 'store-1' };
    return true;
  }
}

@Controller('vendor/products')
class VendorProductsStubController {
  @Get()
  @UseGuards(MockVendorUserGuard, StoreStatusGuard)
  list() {
    return { ok: true };
  }
}

describe('Store suspension (e2e)', () => {
  let app: INestApplication<App>;
  let storeRepository: { findOne: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    storeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'store-1',
        status: StoreStatus.APPROVED,
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [VendorProductsStubController],
      providers: [
        StoreStatusGuard,
        { provide: getRepositoryToken(Store), useValue: storeRepository },
        { provide: APP_PIPE, useClass: ValidationPipe },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('allows vendor requests when store is approved', async () => {
    const res = await request(app.getHttpServer()).get('/vendor/products').expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(storeRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      select: ['id', 'status'],
    });
  });

  it('returns 403 STORE_SUSPENDED when vendor store is suspended', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.SUSPENDED,
    });

    await request(app.getHttpServer())
      .get('/vendor/products')
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('STORE_SUSPENDED');
      });
  });
});
