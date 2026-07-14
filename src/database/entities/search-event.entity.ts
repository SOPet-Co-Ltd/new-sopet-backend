import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('search_events')
export class SearchEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  query!: string;

  @Column({ name: 'result_count', type: 'int', default: 0 })
  resultCount!: number;

  @Column({ name: 'latency_ms', type: 'int', default: 0 })
  latencyMs!: number;

  @Column({ type: 'jsonb', default: {} })
  filters!: Record<string, unknown>;

  @Column({ name: 'session_id', type: 'varchar', length: 64, nullable: true })
  sessionId?: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({ name: 'suggestion_clicked', type: 'boolean', default: false })
  suggestionClicked!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
