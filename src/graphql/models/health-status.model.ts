import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class HealthStatus {
  @Field()
  status!: string;

  @Field()
  api!: string;

  @Field()
  timestamp!: string;
}
