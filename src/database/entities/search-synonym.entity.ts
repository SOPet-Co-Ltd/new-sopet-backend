import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('search_synonyms')
export class SearchSynonym {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', array: true })
  terms!: string[];

  @Column({ type: 'text' })
  expansion!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
