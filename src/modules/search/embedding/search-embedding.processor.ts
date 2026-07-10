import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Product, ProductStatus } from '../../../database/entities/product.entity';
import { ProductEmbedding } from '../../../database/entities/product-embedding.entity';
import { EmbeddingService } from './embedding.service';
import { SEARCH_EMBEDDING_QUEUE, type SearchEmbeddingJobData } from './search-embedding.constants';

@Processor(SEARCH_EMBEDDING_QUEUE, { concurrency: 2 })
export class SearchEmbeddingProcessor extends WorkerHost {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly dataSource: DataSource,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductEmbedding)
    private readonly productEmbeddingRepository: Repository<ProductEmbedding>,
  ) {
    super();
  }

  async process(job: Job<SearchEmbeddingJobData>): Promise<void> {
    const product = await this.productRepository.findOne({
      where: { id: job.data.productId },
      relations: ['brandRelation', 'petTypeRelation', 'categoryRelation'],
    });

    if (!product || product.status !== ProductStatus.PUBLISHED) {
      return;
    }

    const text = this.embeddingService.buildProductEmbeddingText({
      name: product.name,
      description: product.description,
      brandName: product.brandRelation?.name,
      petTypeName: product.petTypeRelation?.name,
      categoryName: product.categoryRelation?.name ?? product.category,
    });

    const embedding = await this.embeddingService.embedText(text);
    if (!embedding) {
      return;
    }

    const vectorLiteral = this.embeddingService.toVectorLiteral(embedding);
    const modelVersion = this.embeddingService.getModelVersion();

    await this.dataSource.query(
      `
      INSERT INTO product_embeddings (product_id, embedding, model_version, updated_at)
      VALUES ($1, $2::vector, $3, NOW())
      ON CONFLICT (product_id) DO UPDATE
      SET embedding = EXCLUDED.embedding,
          model_version = EXCLUDED.model_version,
          updated_at = NOW()
    `,
      [product.id, vectorLiteral, modelVersion],
    );

    await this.productEmbeddingRepository.save({
      productId: product.id,
      modelVersion,
    });
  }
}
