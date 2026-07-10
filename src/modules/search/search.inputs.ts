import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

@InputType()
export class SearchContextInput {
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  recentQueries?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  recentProductIds?: string[];
}

@ObjectType()
export class SearchRankingWeightsType {
  @Field(() => Float)
  text: number;

  @Field(() => Float)
  prefixBoost: number;

  @Field(() => Float)
  soldCount: number;

  @Field(() => Float)
  averageRating: number;

  @Field(() => Float)
  reviewCount: number;

  @Field(() => Float)
  personalizationCap: number;

  @Field(() => Int)
  trigramFallbackThreshold: number;

  @Field(() => Float)
  trigramMinSimilarity: number;

  @Field(() => Int)
  rrfK: number;
}

@InputType()
export class UpdateSearchRankingWeightsInput {
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  text?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  prefixBoost?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  soldCount?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  averageRating?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reviewCount?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.2)
  personalizationCap?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  trigramFallbackThreshold?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  trigramMinSimilarity?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rrfK?: number;
}

@ObjectType()
export class SearchProductSuggestionType {
  @Field(() => String)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  thumbnailUrl?: string | null;
}

@ObjectType()
export class SearchQuerySuggestionType {
  @Field(() => String)
  query: string;
}

@ObjectType()
export class SearchSuggestionsPayloadType {
  @Field(() => [SearchProductSuggestionType])
  products: SearchProductSuggestionType[];

  @Field(() => [SearchQuerySuggestionType])
  queries: SearchQuerySuggestionType[];
}

@ObjectType()
export class SearchSynonymType {
  @Field(() => String)
  id: string;

  @Field(() => [String])
  terms: string[];

  @Field(() => String)
  expansion: string;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => Date)
  updatedAt: Date;
}

@InputType()
export class CreateSearchSynonymInput {
  @Field(() => [String])
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  terms: string[];

  @Field(() => String)
  @IsString()
  @MaxLength(500)
  expansion: string;

  @Field(() => Boolean, { nullable: true, defaultValue: true })
  @IsOptional()
  isActive?: boolean;
}

@InputType()
export class UpdateSearchSynonymInput {
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  terms?: string[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  expansion?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  isActive?: boolean;
}

@ObjectType()
export class SearchAnalyticsSummaryType {
  @Field(() => Int)
  totalSearches: number;

  @Field(() => Int)
  uniqueQueries: number;

  @Field(() => Float)
  zeroResultRate: number;

  @Field(() => Float)
  avgResultsPerQuery: number;

  @Field(() => Float)
  avgLatencyMs: number;
}

@ObjectType()
export class SearchAnalyticsQueryRowType {
  @Field(() => String)
  query: string;

  @Field(() => Int)
  searchCount: number;

  @Field(() => Float)
  avgResultCount: number;
}

@ObjectType()
export class SearchSuggestionCtrRowType {
  @Field(() => String)
  prefixBucket: string;

  @Field(() => Int)
  impressions: number;

  @Field(() => Int)
  clicks: number;

  @Field(() => Float)
  ctr: number;
}
