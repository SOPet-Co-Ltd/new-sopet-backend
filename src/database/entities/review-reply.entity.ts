import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Review } from './review.entity';

export const REVIEW_REPLY_MAX_LENGTH = 1000;

@Entity('review_replies')
export class ReviewReply {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'review_id', type: 'uuid', unique: true })
  @IsNotEmpty()
  reviewId!: string;

  @Column({ name: 'body', type: 'text' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(REVIEW_REPLY_MAX_LENGTH)
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @OneToOne(() => Review, (review) => review.reply, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_id' })
  review!: Review;
}
