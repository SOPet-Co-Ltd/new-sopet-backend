import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { email, deletedAt: IsNull() },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.repository.findOne({
      where: { id, deletedAt: IsNull() },
    });
  }

  async createVendor(data: { email: string; password: string; fullName: string }): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = this.repository.create({
      email: data.email,
      passwordHash,
      fullName: data.fullName,
      role: UserRole.VENDOR,
      isActive: true,
    });

    return this.repository.save(user);
  }

  async createAdmin(data: { email: string; password: string; fullName: string }): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = this.repository.create({
      email: data.email,
      passwordHash,
      fullName: data.fullName,
      role: UserRole.ADMIN,
      isActive: true,
    });

    return this.repository.save(user);
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.repository.update(id, {
      lastLoginAt: new Date(),
    });
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.repository.update(id, { passwordHash });
  }

  async deactivate(id: string): Promise<void> {
    await this.repository.update(id, { isActive: false });
  }

  async activate(id: string): Promise<void> {
    await this.repository.update(id, { isActive: true });
  }

  async softDelete(id: string): Promise<void> {
    await this.repository.softDelete(id);
  }
}
