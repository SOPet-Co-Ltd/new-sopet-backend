import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SEARCH_EMBEDDING_QUEUE, type SearchEmbeddingJobData } from './search-embedding.constants';

@Injectable()
export class SearchEmbeddingQueueService {
  private readonly logger = new Logger(SearchEmbeddingQueueService.name);

  constructor(
    @Optional()
    @InjectQueue(SEARCH_EMBEDDING_QUEUE)
    private readonly queue?: Queue<SearchEmbeddingJobData>,
  ) {}

  async enqueueProductEmbedding(productId: string): Promise<void> {
    if (!this.queue) {
      this.logger.debug(`Embedding queue unavailable — skipped product ${productId}`);
      return;
    }

    await this.queue.add(
      'embed-product',
      { productId },
      {
        jobId: `embed-product:${productId}`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }
}
