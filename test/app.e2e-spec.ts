import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppGraphqlResolver } from '../src/graphql/app.resolver';

describe('GraphQL (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
        }),
      ],
      providers: [AppGraphqlResolver],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('health query', () => {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ health { status api } }' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.health.status).toBe('ok');
        expect(res.body.data.health.api).toBe('graphql');
      });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});
