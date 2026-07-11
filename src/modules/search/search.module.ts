import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import searchConfig from '../../config/search.config';
import { SearchSynonym } from '../../database/entities/search-synonym.entity';
import { SearchEvent } from '../../database/entities/search-event.entity';
import { SearchSuggestionEvent } from '../../database/entities/search-suggestion-event.entity';
import { UserSearchProfile } from '../../database/entities/user-search-profile.entity';
import { ProductEmbedding } from '../../database/entities/product-embedding.entity';
import { Product } from '../../database/entities/product.entity';
import { Setting } from '../../database/entities/setting.entity';
import { RedisModule } from '../redis/redis.module';
import { EmbeddingService } from './embedding/embedding.service';
import { SearchEmbeddingProcessor } from './embedding/search-embedding.processor';
import { SearchEmbeddingQueueService } from './embedding/search-embedding-queue.service';
import { SEARCH_EMBEDDING_QUEUE } from './embedding/search-embedding.constants';
import { PersonalizationService } from './personalization.service';
import { RankingEngine } from './ranking.engine';
import { RrfEngine } from './rrf.engine';
import { SearchAnalyticsService } from './search-analytics.service';
import { SearchRepository } from './search.repository';
import { SearchResolver } from './search.resolver';
import { SearchService } from './search.service';
import { SearchSettingsService } from './search-settings.service';
import { SearchSynonymService } from './search-synonym.service';
import { SearchSuggestionsService } from './search-suggestions.service';
import { VectorSearchSupport } from './vector-search.support';

@Module({
  imports: [
    ConfigModule.forFeature(searchConfig),
    RedisModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: SEARCH_EMBEDDING_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
      },
    }),
    TypeOrmModule.forFeature([
      Product,
      Setting,
      SearchSynonym,
      SearchEvent,
      SearchSuggestionEvent,
      UserSearchProfile,
      ProductEmbedding,
    ]),
  ],
  providers: [
    SearchService,
    SearchRepository,
    SearchSettingsService,
    SearchSynonymService,
    SearchSuggestionsService,
    SearchAnalyticsService,
    PersonalizationService,
    RankingEngine,
    RrfEngine,
    VectorSearchSupport,
    EmbeddingService,
    SearchEmbeddingQueueService,
    SearchEmbeddingProcessor,
    SearchResolver,
  ],
  exports: [
    SearchService,
    SearchRepository,
    SearchSettingsService,
    SearchSynonymService,
    SearchSuggestionsService,
    SearchAnalyticsService,
    SearchEmbeddingQueueService,
    PersonalizationService,
  ],
})
export class SearchModule {}
