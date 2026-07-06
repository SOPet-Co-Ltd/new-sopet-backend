import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators';
import { PaymentsService } from './payments.service';

@Controller('webhooks')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('omise')
  @HttpCode(200)
  async handleOmiseWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: Record<string, unknown>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    const signature = req.headers['omise-signature'] as string | undefined;
    const timestamp = req.headers['omise-signature-timestamp'] as string | undefined;

    const verified = this.paymentsService.verifyOmiseWebhookSignature(
      rawBody,
      signature,
      timestamp,
    );
    if (!verified) {
      throw new UnauthorizedException('Invalid Omise webhook signature');
    }

    await this.paymentsService.handleWebhook(payload);
    return { received: true };
  }
}
