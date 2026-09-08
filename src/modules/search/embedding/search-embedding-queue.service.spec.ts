import { SearchEmbeddingQueueService } from './search-embedding-queue.service';

describe('SearchEmbeddingQueueService', () => {
  it('no-ops when the queue is unavailable', async () => {
    const service = new SearchEmbeddingQueueService(undefined);
    await expect(service.enqueueProductEmbeddings(['prod-1', 'prod-2'])).resolves.toBeUndefined();
  });

  it('enqueues many products with a single addBulk call', async () => {
    const addBulk = jest.fn().mockResolvedValue([]);
    const service = new SearchEmbeddingQueueService({ addBulk } as never);

    await service.enqueueProductEmbeddings(['prod-1', 'prod-1', 'prod-2']);

    expect(addBulk).toHaveBeenCalledTimes(1);
    expect(addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'embed-product',
        data: { productId: 'prod-1' },
        opts: expect.objectContaining({ jobId: 'embed-product:prod-1' }),
      }),
      expect.objectContaining({
        name: 'embed-product',
        data: { productId: 'prod-2' },
        opts: expect.objectContaining({ jobId: 'embed-product:prod-2' }),
      }),
    ]);
  });

  it('delegates single enqueue to addBulk', async () => {
    const addBulk = jest.fn().mockResolvedValue([]);
    const service = new SearchEmbeddingQueueService({ addBulk } as never);

    await service.enqueueProductEmbedding('prod-9');

    expect(addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: { productId: 'prod-9' },
      }),
    ]);
  });
});
