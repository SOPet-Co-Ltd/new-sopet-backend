import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsOptional, Length } from 'class-validator';

@Entity('platform_ads')
@Index(['isActive', 'sortOrder'])
export class PlatformAd {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  title!: string;

  @Column({ name: 'image_url', type: 'varchar', length: 500 })
  @IsNotEmpty()
  imageUrl!: string;

  @Column({ name: 'link_url', type: 'varchar', length: 500, nullable: true })
  @IsOptional()
  linkUrl!: string | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;
}
