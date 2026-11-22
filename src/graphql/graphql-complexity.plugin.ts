import type { ApolloServerPlugin } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';

/** Complexity check after Apollo validates variables (static validationRules cannot see them). */
export function createGraphqlComplexityPlugin(maximumComplexity: number): ApolloServerPlugin {
  return {
    requestDidStart: () =>
      Promise.resolve({
        didResolveOperation: (requestContext) => {
          const complexity = getComplexity({
            schema: requestContext.schema,
            query: requestContext.document,
            operationName: requestContext.request.operationName ?? undefined,
            variables: requestContext.request.variables ?? {},
            estimators: [simpleEstimator({ defaultComplexity: 1 })],
          });

          if (complexity > maximumComplexity) {
            throw new GraphQLError(
              `Query is too complex: ${complexity}. Maximum allowed complexity: ${maximumComplexity}`,
              { extensions: { code: 'QUERY_TOO_COMPLEX' } },
            );
          }

          return Promise.resolve();
        },
      }),
  };
}
