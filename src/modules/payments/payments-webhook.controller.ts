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
  @Post('beam')
  @HttpCode(200)
  async handleBeamWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: Record<string, unknown>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    const signature = req.headers['x-beam-signature'] as string | undefined;
    if (!this.paymentsService.verifyBeamWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid Beam webhook signature');
    }

    await this.paymentsService.handleBeamWebhook(payload);
    return { received: true };
  }
}
