import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailService } from './email.service';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailTemplateCacheService } from './email-template-cache.service';
import { EmailTemplateRendererService } from './email-template-renderer.service';
import { EmailCmsService } from './email-cms.service';
import { EmailCmsResolver } from './email-cms.resolver';
import { EmailContainer } from '../../database/entities/email-container.entity';
import { EmailContentTemplate } from '../../database/entities/email-content-template.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EmailContainer, EmailContentTemplate])],
  providers: [
    EmailService,
    EmailDeliveryService,
    EmailTemplateCacheService,
    EmailTemplateRendererService,
    EmailCmsService,
    EmailCmsResolver,
  ],
  exports: [
    EmailService,
    EmailDeliveryService,
    EmailTemplateCacheService,
    EmailTemplateRendererService,
    EmailCmsService,
  ],
})
export class EmailModule {}
