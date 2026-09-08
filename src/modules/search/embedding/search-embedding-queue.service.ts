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
    await this.enqueueProductEmbeddings([productId]);
  }

  /** Enqueue many product embedding jobs in one Redis pipeline. */
  async enqueueProductEmbeddings(productIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(productIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return;
    }

    if (!this.queue) {
      this.logger.debug(
        `Embedding queue unavailable — skipped ${uniqueIds.length} product embedding(s)`,
      );
      return;
    }

    await this.queue.addBulk(
      uniqueIds.map((productId) => ({
        name: 'embed-product',
        data: { productId },
        opts: {
          jobId: `embed-product:${productId}`,
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 5000 },
        },
      })),
    );
  }
}
