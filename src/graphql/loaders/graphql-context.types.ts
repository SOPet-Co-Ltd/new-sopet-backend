import type DataLoader from 'dataloader';

export interface GraphqlLoaders {
  productSoldCount: DataLoader<string, number>;
}

export interface GraphqlContext {
  req: unknown;
  res: unknown;
  loaders: GraphqlLoaders;
}
