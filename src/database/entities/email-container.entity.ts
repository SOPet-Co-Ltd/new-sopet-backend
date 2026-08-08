import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { IsBoolean, IsNotEmpty, Length } from 'class-validator';

/**
 * Global reusable HTML shell (brand chrome) with a `{{{content}}}` slot.
 * Content templates reference exactly one container via `containerId`.
 */
@Entity('email_containers')
@Index(['isDefault'])
export class EmailContainer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  /** Full HTML document shell containing exactly one `{{{content}}}` slot. */
  @Column({ name: 'html_shell', type: 'text' })
  @IsNotEmpty()
  htmlShell!: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  @IsBoolean()
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
