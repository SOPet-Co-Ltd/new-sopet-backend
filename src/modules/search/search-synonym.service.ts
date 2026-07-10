import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchSynonym } from '../../database/entities/search-synonym.entity';
import { RedisService } from '../redis/redis.service';

const SYNONYMS_CACHE_KEY = 'search:synonyms:v1';
const SYNONYMS_CACHE_TTL_SECONDS = 60;
const MAX_SYNONYM_TERMS = 20;

export type SearchSynonymRecord = {
  id: string;
  terms: string[];
  expansion: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSearchSynonymInput = {
  terms: string[];
  expansion: string;
  isActive?: boolean;
};

export type UpdateSearchSynonymInput = {
  terms?: string[];
  expansion?: string;
  isActive?: boolean;
};

@Injectable()
export class SearchSynonymService {
  constructor(
    @InjectRepository(SearchSynonym)
    private readonly synonymRepository: Repository<SearchSynonym>,
    private readonly redisService: RedisService,
  ) {}

  async findAll(): Promise<SearchSynonymRecord[]> {
    const rows = await this.synonymRepository.find({ order: { updatedAt: 'DESC' } });
    return rows.map((row) => this.toRecord(row));
  }

  async create(input: CreateSearchSynonymInput): Promise<SearchSynonymRecord> {
    const terms = this.normalizeTerms(input.terms);
    const expansion = this.sanitizeExpansion(input.expansion);

    const row = await this.synonymRepository.save(
      this.synonymRepository.create({
        terms,
        expansion,
        isActive: input.isActive ?? true,
      }),
    );

    await this.invalidateCache();
    return this.toRecord(row);
  }

  async update(id: string, input: UpdateSearchSynonymInput): Promise<SearchSynonymRecord> {
    const row = await this.synonymRepository.findOne({ where: { id } });
    if (!row) {
      throw new BadRequestException('Synonym not found');
    }

    if (input.terms !== undefined) {
      row.terms = this.normalizeTerms(input.terms);
    }
    if (input.expansion !== undefined) {
      row.expansion = this.sanitizeExpansion(input.expansion);
    }
    if (input.isActive !== undefined) {
      row.isActive = input.isActive;
    }

    const saved = await this.synonymRepository.save(row);
    await this.invalidateCache();
    return this.toRecord(saved);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.synonymRepository.delete({ id });
    await this.invalidateCache();
    return (result.affected ?? 0) > 0;
  }

  async expandQuery(rawQuery: string): Promise<string> {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      return trimmed;
    }

    const synonyms = await this.loadActiveSynonyms();
    if (synonyms.length === 0) {
      return trimmed;
    }

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const expansions = new Set<string>();

    for (const token of tokens) {
      const normalizedToken = token.toLowerCase();
      for (const synonym of synonyms) {
        const matched = synonym.terms.some((term) => term.toLowerCase() === normalizedToken);
        if (matched) {
          expansions.add(synonym.expansion);
        }
      }
    }

    if (expansions.size === 0) {
      return trimmed;
    }

    return `${trimmed} ${[...expansions].join(' ')}`.trim();
  }

  normalizeTerms(terms: string[]): string[] {
    if (!Array.isArray(terms) || terms.length === 0) {
      throw new BadRequestException('Synonym terms are required');
    }

    const normalized = [...new Set(terms.map((term) => this.sanitizeTerm(term)).filter(Boolean))];
    if (normalized.length === 0) {
      throw new BadRequestException('Synonym terms are required');
    }
    if (normalized.length > MAX_SYNONYM_TERMS) {
      throw new BadRequestException(`Synonym terms must not exceed ${MAX_SYNONYM_TERMS}`);
    }

    return normalized;
  }

  sanitizeExpansion(expansion: string): string {
    const trimmed = expansion.trim();
    if (!trimmed) {
      throw new BadRequestException('Synonym expansion is required');
    }
    if (/[<>;]/.test(trimmed)) {
      throw new BadRequestException('Synonym expansion contains invalid characters');
    }
    return trimmed.slice(0, 500);
  }

  private sanitizeTerm(term: string): string {
    return term.trim().replace(/\s+/g, ' ').slice(0, 100);
  }

  private async loadActiveSynonyms(): Promise<Array<{ terms: string[]; expansion: string }>> {
    const cached = await this.redisService.get(SYNONYMS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as Array<{ terms: string[]; expansion: string }>;
    }

    const rows = await this.synonymRepository.find({
      where: { isActive: true },
      order: { updatedAt: 'DESC' },
    });

    const payload = rows.map((row) => ({
      terms: row.terms,
      expansion: row.expansion,
    }));

    await this.redisService.set(
      SYNONYMS_CACHE_KEY,
      JSON.stringify(payload),
      SYNONYMS_CACHE_TTL_SECONDS,
    );

    return payload;
  }

  private async invalidateCache(): Promise<void> {
    await this.redisService.del(SYNONYMS_CACHE_KEY);
  }

  private toRecord(row: SearchSynonym): SearchSynonymRecord {
    return {
      id: row.id,
      terms: row.terms,
      expansion: row.expansion,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
