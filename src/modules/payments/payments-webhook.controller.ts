import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  BadRequestException,
  HttpCode,
  Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators';
import { PaymentsService } from './payments.service';

const HANDLED_BEAM_EVENTS = new Set(['charge.succeeded', 'charge.failed']);

@Controller('webhooks')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

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

    const eventHeader = req.headers['x-beam-event'];
    const eventType = Array.isArray(eventHeader)
      ? eventHeader[0]?.trim()
      : typeof eventHeader === 'string'
        ? eventHeader.trim()
        : '';

    if (!eventType || !HANDLED_BEAM_EVENTS.has(eventType)) {
      this.logger.log(
        `Ignoring Beam webhook event=${eventType || '(missing)'} (only charge.succeeded/failed handled)`,
      );
      return { received: true, ignored: true };
    }

    await this.paymentsService.handleBeamWebhook(payload, eventType);
    return { received: true };
  }
}
