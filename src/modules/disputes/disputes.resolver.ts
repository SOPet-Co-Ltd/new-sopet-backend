import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { DisputesService } from './disputes.service';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DisputeIssueType } from '../../database/entities/dispute.entity';
import { Dispute } from '../../database/entities/dispute.entity';
import { DisputeMessage } from '../../database/entities/dispute-message.entity';
import { DisputeImage } from '../../database/entities/dispute-image.entity';

@ObjectType()
export class DisputeMessageType {
  @Field()
  id: string;

  @Field()
  senderType: string;

  @Field()
  message: string;

  @Field(() => [String])
  attachments: string[];

  @Field()
  createdAt: Date;
}

@ObjectType()
export class DisputeImageType {
  @Field()
  id: string;

  @Field()
  imageUrl: string;

  @Field()
  sortOrder: number;
}

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

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  @Field(() => [DisputeMessageType])
  messages: DisputeMessageType[];

  @Field(() => [DisputeImageType])
  images: DisputeImageType[];
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

function mapDisputeMessage(message: DisputeMessage): DisputeMessageType {
  return {
    id: message.id,
    senderType: message.senderType,
    message: message.message,
    attachments: message.attachments ?? [],
    createdAt: message.createdAt,
  };
}

function mapDisputeImage(image: DisputeImage): DisputeImageType {
  return {
    id: image.id,
    imageUrl: image.imageUrl,
    sortOrder: image.sortOrder,
  };
}

function mapDispute(dispute: Dispute): DisputeType {
  const messages = [...(dispute.messages ?? [])].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const images = [...(dispute.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    id: dispute.id,
    orderId: dispute.orderId,
    reason: dispute.reason,
    issueType: dispute.issueType,
    status: dispute.status,
    createdAt: dispute.createdAt,
    updatedAt: dispute.updatedAt,
    messages: messages.map(mapDisputeMessage),
    images: images.map(mapDisputeImage),
  };
}
