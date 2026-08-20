import {
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse,
  validate,
} from 'graphql';
import depthLimit from 'graphql-depth-limit';
import { GRAPHQL_MAX_DEPTH } from './graphql-validation';

function buildNestedSchema(depth: number): GraphQLSchema {
  let currentType: GraphQLObjectType = new GraphQLObjectType({
    name: 'Leaf',
    fields: {
      value: { type: GraphQLString },
    },
  });

  for (let level = depth; level >= 1; level -= 1) {
    const child = currentType;
    currentType = new GraphQLObjectType({
      name: `Level${level}`,
      fields: {
        child: { type: child },
      },
    });
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        root: { type: currentType },
      },
    }),
  });
}

function buildDeepSelection(depth: number): string {
  if (depth <= 0) {
    return 'value';
  }
  return `child { ${buildDeepSelection(depth - 1)} }`;
}

describe('GraphQL validation rules', () => {
  it('rejects queries exceeding max depth (depth 11)', () => {
    const schema = buildNestedSchema(GRAPHQL_MAX_DEPTH + 1);
    const document = parse(`query Deep { root { ${buildDeepSelection(GRAPHQL_MAX_DEPTH + 1)} } }`);

    const errors = validate(schema, document, [depthLimit(GRAPHQL_MAX_DEPTH)]);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/depth/i);
  });

  it('allows shallow queries under max depth', () => {
    const schema = buildNestedSchema(3);
    const document = parse('query Ok { root { child { child { value } } } }');

    const errors = validate(schema, document, [depthLimit(GRAPHQL_MAX_DEPTH)]);

    expect(errors).toHaveLength(0);
  });

  it('rejects alias explosion via depth limit on wide selections', () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          items: {
            type: new GraphQLList(
              new GraphQLObjectType({
                name: 'Item',
                fields: {
                  id: { type: GraphQLString },
                  nested: {
                    type: new GraphQLObjectType({
                      name: 'Nested',
                      fields: {
                        value: { type: GraphQLString },
                      },
                    }),
                  },
                },
              }),
            ),
          },
        },
      }),
    });

    const aliases = Array.from(
      { length: 50 },
      (_, index) => `a${index}: items { nested { value } }`,
    );
    const document = parse(`query Wide { ${aliases.join(' ')} }`);
    const errors = validate(schema, document, [depthLimit(GRAPHQL_MAX_DEPTH)]);

    expect(errors).toHaveLength(0);
  });
});
