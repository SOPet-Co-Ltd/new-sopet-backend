import depthLimit from 'graphql-depth-limit';
import {
  createComplexityLimitRule,
  fieldExtensionsEstimator,
  simpleEstimator,
} from 'graphql-query-complexity';
import type { ValidationRule } from 'graphql';

export const GRAPHQL_MAX_DEPTH = 10;
export const GRAPHQL_MAX_COMPLEXITY = 1000;

export function isGraphqlPlaygroundEnabled(): boolean {
  return process.env.GRAPHQL_PLAYGROUND === 'true';
}

export function buildGraphqlValidationRules(): ValidationRule[] {
  return [
    depthLimit(GRAPHQL_MAX_DEPTH),
    createComplexityLimitRule(GRAPHQL_MAX_COMPLEXITY, {
      estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
    }),
  ];
}
