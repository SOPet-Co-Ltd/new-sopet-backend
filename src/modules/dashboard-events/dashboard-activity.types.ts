import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';
import { DashboardActivityKind } from './dashboard-activity.constants';

registerEnumType(DashboardActivityKind, {
  name: 'DashboardActivityKind',
});

@ObjectType()
export class DashboardActivityType {
  @Field(() => DashboardActivityKind)
  kind!: DashboardActivityKind;

  @Field()
  entityId!: string;

  @Field(() => String, { nullable: true })
  storeId?: string | null;
}
