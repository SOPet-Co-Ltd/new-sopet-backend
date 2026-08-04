import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('search_suggestion_events')
export class SearchSuggestionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'query_prefix', type: 'text' })
  queryPrefix!: string;

  @Column({ name: 'suggestion_query', type: 'text', nullable: true })
  suggestionQuery?: string | null;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null;

  @Column({ name: 'session_id', type: 'varchar', length: 64, nullable: true })
  sessionId?: string | null;

  @Column({ type: 'boolean', default: false })
  clicked!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
