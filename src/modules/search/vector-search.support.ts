import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class VectorSearchSupport {
  private availability: boolean | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isAvailable(): Promise<boolean> {
    if (this.availability !== null) {
      return this.availability;
    }

    const rows = await this.dataSource.query(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'vector'
      ) AS vector_enabled
    `);

    this.availability = rows?.[0]?.vector_enabled === true;
    return this.availability;
  }

  resetCache(): void {
    this.availability = null;
  }
}
