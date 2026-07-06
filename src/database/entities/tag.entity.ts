import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsEnum, IsNotEmpty, Length } from 'class-validator';
import { User } from './user.entity';
import { Product } from './product.entity';
import { TaxonomyApprovalStatus } from './enums/taxonomy.enums';

/**
 * Global product tag taxonomy shared across all stores (not store-scoped).
 */
@Entity('tags')
@Index(['slug'], { unique: true })
@Index(['approvalStatus'])
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  name: string;

  @Column({ name: 'slug', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  slug: string;

  @Column({
    name: 'approval_status',
    type: 'enum',
    enum: TaxonomyApprovalStatus,
    default: TaxonomyApprovalStatus.PENDING,
  })
  @IsEnum(TaxonomyApprovalStatus)
  approvalStatus: TaxonomyApprovalStatus;

  @Column({ name: 'created_by', type: 'uuid' })
  @IsNotEmpty()
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @ManyToMany(() => Product, (product) => product.taxonomyTags)
  products: Product[];
}
