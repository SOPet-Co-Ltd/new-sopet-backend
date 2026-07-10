import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from './search-embedding.constants';

type OpenAiEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('search.openAiApiKey'));
  }

  getModelVersion(): string {
    return EMBEDDING_MODEL;
  }

  getDimension(): number {
    return EMBEDDING_DIMENSION;
  }

  buildProductEmbeddingText(input: {
    name: string;
    description?: string | null;
    brandName?: string | null;
    petTypeName?: string | null;
    categoryName?: string | null;
  }): string {
    const parts = [
      input.name,
      input.description,
      input.brandName,
      input.petTypeName,
      input.categoryName,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .map((part) => part.trim());

    return parts.join(' ').slice(0, 8000);
  }

  async embedText(text: string): Promise<number[] | null> {
    const apiKey = this.configService.get<string>('search.openAiApiKey');
    if (!apiKey || !text.trim()) {
      return null;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: text,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`OpenAI embeddings API returned ${response.status}`);
        return null;
      }

      const payload = (await response.json()) as OpenAiEmbeddingResponse;
      const embedding = payload.data?.[0]?.embedding;
      if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
        this.logger.warn('OpenAI embeddings response missing expected vector dimension');
        return null;
      }

      return embedding;
    } catch (error) {
      this.logger.warn(
        `OpenAI embeddings request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
