import depthLimit from 'graphql-depth-limit';
import type { ValidationRule } from 'graphql';

export const GRAPHQL_MAX_DEPTH = 10;
export const GRAPHQL_MAX_COMPLEXITY = 1000;

export function isGraphqlPlaygroundEnabled(): boolean {
  return process.env.GRAPHQL_PLAYGROUND === 'true';
}

/** Depth-only validation rules. Complexity runs in GraphqlComplexityPlugin. */
export function buildGraphqlValidationRules(): ValidationRule[] {
  return [depthLimit(GRAPHQL_MAX_DEPTH)];
}
