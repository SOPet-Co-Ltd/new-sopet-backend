import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Customer } from '../entities/customer.entity';

@Injectable()
export class CustomerRepository {
  constructor(
    @InjectRepository(Customer)
    private readonly repository: Repository<Customer>,
  ) {}

  async findByPhone(phone: string): Promise<Customer | null> {
    return this.repository.findOne({
      where: { phone, deletedAt: IsNull() },
    });
  }

  async findById(id: string): Promise<Customer | null> {
    return this.repository.findOne({
      where: { id, deletedAt: IsNull() },
    });
  }

  async findWithAddresses(id: string): Promise<Customer | null> {
    return this.repository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['savedAddresses'],
    });
  }

  async findWithPaymentMethods(id: string): Promise<Customer | null> {
    return this.repository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['savedPaymentMethods'],
    });
  }

  async createOrUpdate(phone: string, data: Partial<Customer>): Promise<Customer> {
    const existing = await this.findByPhone(phone);

    if (existing) {
      await this.repository.update(existing.id, data as QueryDeepPartialEntity<Customer>);
      const updated = await this.findById(existing.id);
      return updated!;
    }

    const customer = this.repository.create({
      phone,
      ...data,
    });

    return this.repository.save(customer);
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.repository.update(id, {
      lastLoginAt: new Date(),
    });
  }

  async markVerified(id: string): Promise<void> {
    await this.repository.update(id, {
      isVerified: true,
    });
  }

  async updateProfile(id: string, data: { fullName?: string; email?: string }): Promise<void> {
    await this.repository.update(id, data);
  }

  async softDelete(id: string): Promise<void> {
    await this.repository.softDelete(id);
  }

  async finalizeDeletion(id: string): Promise<void> {
    await this.repository.update(id, { fullName: null, email: null });
    await this.softDelete(id);
  }
}
