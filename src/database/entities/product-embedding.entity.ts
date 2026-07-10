import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('product_embeddings')
export class ProductEmbedding {
  @PrimaryColumn({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'model_version', type: 'varchar', length: 64 })
  modelVersion: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
