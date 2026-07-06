import { Module } from '@nestjs/common';
import { OmiseService } from './omise.service';

@Module({
  providers: [OmiseService],
  exports: [OmiseService],
})
export class OmiseModule {}
