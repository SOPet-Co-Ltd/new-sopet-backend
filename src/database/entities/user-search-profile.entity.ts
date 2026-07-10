import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_search_profiles')
export class UserSearchProfile {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'recent_queries', type: 'jsonb', default: [] })
  recentQueries: string[];

  @Column({ name: 'recent_product_ids', type: 'jsonb', default: [] })
  recentProductIds: string[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
