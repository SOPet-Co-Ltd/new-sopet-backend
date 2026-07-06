import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { DisputesService } from './disputes.service';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DisputeIssueType } from '../../database/entities/dispute.entity';

@ObjectType()
export class DisputeType {
  @Field()
  id: string;

  @Field()
  orderId: string;

  @Field()
  reason: string;

  @Field()
  issueType: string;

  @Field()
  status: string;
}

@InputType()
export class CreateDisputeInput {
  @Field()
  @IsUUID()
  orderId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  reason: string;

  @Field()
  @IsEnum(DisputeIssueType)
  issueType: DisputeIssueType;
}

@Resolver()
export class DisputesResolver {
  constructor(private readonly disputesService: DisputesService) {}

  @Query(() => [DisputeType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async myDisputes(@CurrentUser('id') customerId: string): Promise<DisputeType[]> {
    const disputes = await this.disputesService.findByCustomer(customerId);
    return disputes.map(mapDispute);
  }

  @Query(() => [DisputeType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async openDisputes(): Promise<DisputeType[]> {
    const disputes = await this.disputesService.findOpen();
    return disputes.map(mapDispute);
  }

  @Mutation(() => DisputeType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async createDispute(
    @CurrentUser('id') customerId: string,
    @Args('input') input: CreateDisputeInput,
  ): Promise<DisputeType> {
    const dispute = await this.disputesService.create({
      customerId,
      orderId: input.orderId,
      reason: input.reason,
      issueType: input.issueType,
    });
    return mapDispute(dispute);
  }
}

function mapDispute(d: {
  id: string;
  orderId: string;
  reason: string;
  issueType: string;
  status: string;
}): DisputeType {
  return {
    id: d.id,
    orderId: d.orderId,
    reason: d.reason,
    issueType: d.issueType,
    status: d.status,
  };
}
