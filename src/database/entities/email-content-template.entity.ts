import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsBoolean, IsNotEmpty, Length } from 'class-validator';
import { EmailContainer } from './email-container.entity';
import { EmailTemplateKey } from './enums/email-template.enums';

/**
 * Per-route transactional email content (subject + inner body HTML + optional
 * plaintext). One row per `EmailTemplateKey`; seeded once, update-only in MVP.
 */
@Entity('email_content_templates')
@Index(['key'], { unique: true })
export class EmailContentTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'key', type: 'varchar', length: 64, unique: true })
  @IsNotEmpty()
  key!: EmailTemplateKey;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  /** May contain `{{vars}}`; substituted without HTML escaping (plaintext context). */
  @Column({ name: 'subject_template', type: 'text' })
  @IsNotEmpty()
  subjectTemplate!: string;

  /** Inner body only (not a full document); injected into container `{{{content}}}`. */
  @Column({ name: 'body_html', type: 'text' })
  @IsNotEmpty()
  bodyHtml!: string;

  /** Plaintext with the same `{{vars}}`; falls back to stripped `bodyHtml` when empty. */
  @Column({ name: 'text_template', type: 'text', default: '' })
  textTemplate!: string;

  @Column({ name: 'container_id', type: 'uuid' })
  @IsNotEmpty()
  containerId!: string;

  /** `false` forces the TS fallback template for this key (row is kept, not deleted). */
  @Column({ name: 'enabled', type: 'boolean', default: true })
  @IsBoolean()
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @ManyToOne(() => EmailContainer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'container_id' })
  container!: EmailContainer;
}
