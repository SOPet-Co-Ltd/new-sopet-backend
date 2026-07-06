import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OmiseModule } from '../omise/omise.module';
import { StoresService } from './stores.service';
import { StoreTeamService } from './store-team.service';
import { ShippingOptionsService } from './shipping-options.service';
import { ShippingProvidersService } from './shipping-providers.service';
import { StoreRequestService } from './store-request.service';
import { StoreReactivationRequestService } from './store-reactivation-request.service';
import { VendorInvitationService } from './vendor-invitation.service';
import { Store } from '../../database/entities/store.entity';
import { User } from '../../database/entities/user.entity';
import { StoreMember } from '../../database/entities/store-member.entity';
import { StoreMemberInvitation } from '../../database/entities/store-member-invitation.entity';
import { StoreShippingOption } from '../../database/entities/store-shipping-option.entity';
import { ShippingProvider } from '../../database/entities/shipping-provider.entity';
import { StoreRequest } from '../../database/entities/store-request.entity';
import { StoreReactivationRequest } from '../../database/entities/store-reactivation-request.entity';
import { StoreReactivationRequestImage } from '../../database/entities/store-reactivation-request-image.entity';
import { VendorInvitation } from '../../database/entities/vendor-invitation.entity';
import { StoresResolver } from './stores.resolver';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    OmiseModule,
    TypeOrmModule.forFeature([
      Store,
      User,
      StoreMember,
      StoreMemberInvitation,
      StoreShippingOption,
      ShippingProvider,
      StoreRequest,
      StoreReactivationRequest,
      StoreReactivationRequestImage,
      VendorInvitation,
    ]),
  ],
  providers: [
    StoresService,
    StoreTeamService,
    ShippingOptionsService,
    ShippingProvidersService,
    StoreRequestService,
    StoreReactivationRequestService,
    VendorInvitationService,
    StoresResolver,
  ],
  exports: [
    StoresService,
    StoreTeamService,
    ShippingOptionsService,
    ShippingProvidersService,
    StoreRequestService,
    StoreReactivationRequestService,
    VendorInvitationService,
  ],
})
export class StoresModule {}
