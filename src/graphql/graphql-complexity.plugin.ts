import type {
  ApolloServerPlugin,
  BaseContext,
  GraphQLRequestListener,
  GraphQLServerContext,
} from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { GraphQLError, type GraphQLSchema } from 'graphql';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';
import { GRAPHQL_MAX_COMPLEXITY } from './graphql-validation';

/**
 * Query complexity must run as an Apollo plugin (not a validation rule) so
 * request variables are available. `createComplexityRule` sees `{}` variables
 * and falsely rejects every operation that declares required `$input` / `$id`.
 */
@Plugin()
export class GraphqlComplexityPlugin implements ApolloServerPlugin<BaseContext> {
  private schema!: GraphQLSchema;

  async serverWillStart(service: GraphQLServerContext): Promise<void> {
    this.schema = service.schema;
  }

  async requestDidStart(): Promise<GraphQLRequestListener<BaseContext>> {
    const schema = this.schema;
    return {
      async didResolveOperation({ request, document }): Promise<void> {
        let complexity: number;
        try {
          complexity = getComplexity({
            schema,
            operationName: request.operationName ?? undefined,
            query: document,
            variables: request.variables ?? {},
            estimators: [fieldExtensionsEstimator(), simpleEstimator({ defaultComplexity: 1 })],
          });
        } catch (error) {
          // Missing/invalid variables: surface as client input, not 500.
          if (error instanceof GraphQLError) {
            throw new GraphQLError(error.message, {
              nodes: error.nodes,
              source: error.source,
              positions: error.positions,
              path: error.path,
              originalError: error.originalError,
              extensions: {
                ...error.extensions,
                code: 'BAD_USER_INPUT',
              },
            });
          }
          throw error;
        }

        if (complexity > GRAPHQL_MAX_COMPLEXITY) {
          throw new GraphQLError(
            `Query exceeds maximum complexity of ${GRAPHQL_MAX_COMPLEXITY}. Actual complexity is ${complexity}`,
            {
              extensions: { code: 'QUERY_TOO_COMPLEX' },
            },
          );
        }
      },
    };
  }
}
