import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Customer } from '../../database/entities/customer.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import {
  SavedPaymentMethod,
  PaymentMethodType,
} from '../../database/entities/saved-payment-method.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { OtpCode } from '../../database/entities/otp-code.entity';
import { OrdersService } from '../orders/orders.service';
import { normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';
import { UpdateProfileDto, CreateAddressDto, UpdateAddressDto } from './dto';
import { JwtPayload } from '../../common/interfaces';
import { isPendingDeletion, isDeletionRetentionExpired } from '../customers/customer-deletion.util';

interface ReactivationJwtPayload {
  sub: string;
  purpose: 'reactivation';
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(SavedAddress)
    private addressRepository: Repository<SavedAddress>,
    @InjectRepository(SavedPaymentMethod)
    private paymentMethodRepository: Repository<SavedPaymentMethod>,
    @InjectRepository(OtpCode)
    private otpRepository: Repository<OtpCode>,
    private readonly customerRepo: CustomerRepository,
    private readonly ordersService: OrdersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // Get customer profile
  async getProfile(customerId: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
      relations: ['savedAddresses', 'savedPaymentMethods'],
    });

    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }

    return customer;
  }

  // Update customer profile
  async updateProfile(customerId: string, updateProfileDto: UpdateProfileDto): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }

    Object.assign(customer, updateProfileDto);
    return this.customerRepository.save(customer);
  }

  async changeCustomerPhone(
    customerId: string,
    newPhone: string,
    code: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    customer: Customer;
  }> {
    const normalizedNewPhone = normalizeThaiPhoneToLocal(newPhone);

    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }

    if (normalizedNewPhone === normalizeThaiPhoneToLocal(customer.phone)) {
      throw new BadRequestException({
        code: 'PHONE_UNCHANGED',
        message: 'New phone number is the same as the current phone number',
      });
    }

    const existing = await this.customerRepo.findOtherActiveByPhone(normalizedNewPhone, customerId);
    if (existing) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_EXISTS',
        message: 'Phone number is already in use',
      });
    }

    const otp = await this.otpRepository.findOne({
      where: {
        phone: normalizedNewPhone,
        code,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!otp) {
      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'Invalid or expired OTP code',
      });
    }

    otp.isUsed = true;
    await this.otpRepository.save(otp);

    const oldPhone = customer.phone;
    customer.phone = normalizedNewPhone;
    await this.customerRepository.save(customer);

    await this.ordersService.mergeGuestOrders(customerId, oldPhone);
    await this.ordersService.mergeGuestOrders(customerId, normalizedNewPhone);

    const { accessToken, refreshToken } = await this.generateTokens({
      sub: customer.id,
      phone: customer.phone,
      role: 'customer',
    });

    return { accessToken, refreshToken, customer };
  }

  // Get all saved addresses
  async getAddresses(customerId: string): Promise<SavedAddress[]> {
    return this.addressRepository.find({
      where: { customerId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  // Create new address
  async createAddress(
    customerId: string,
    createAddressDto: CreateAddressDto,
  ): Promise<SavedAddress> {
    // If this is set as default, unset other default addresses
    if (createAddressDto.isDefault) {
      await this.addressRepository.update({ customerId, isDefault: true }, { isDefault: false });
    }

    const amphoe = createAddressDto.amphoe ?? createAddressDto.city;
    if (!amphoe) {
      throw new BadRequestException({
        code: 'INVALID_ADDRESS',
        message: 'amphoe is required',
      });
    }

    const address = this.addressRepository.create({
      customerId,
      label: createAddressDto.label,
      fullName: createAddressDto.recipientName,
      phone: normalizeThaiPhoneToLocal(createAddressDto.recipientPhone),
      addressLine1: createAddressDto.addressLine1,
      addressLine2: createAddressDto.addressLine2 ?? null,
      tumbon: createAddressDto.tumbon ?? null,
      amphoe,
      district: amphoe,
      province: createAddressDto.province,
      postalCode: createAddressDto.postalCode,
      isDefault: createAddressDto.isDefault ?? false,
    });

    return this.addressRepository.save(address);
  }

  // Update address
  async updateAddress(
    customerId: string,
    addressId: string,
    updateAddressDto: UpdateAddressDto,
  ): Promise<SavedAddress> {
    const address = await this.addressRepository.findOne({
      where: { id: addressId, customerId },
    });

    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Address not found',
      });
    }

    // If setting as default, unset other defaults
    if (updateAddressDto.isDefault) {
      await this.addressRepository.update({ customerId, isDefault: true }, { isDefault: false });
    }

    const amphoe = updateAddressDto.amphoe ?? updateAddressDto.city ?? address.amphoe;

    Object.assign(address, {
      ...updateAddressDto,
      fullName: updateAddressDto.recipientName ?? address.fullName,
      phone: updateAddressDto.recipientPhone
        ? normalizeThaiPhoneToLocal(updateAddressDto.recipientPhone)
        : address.phone,
      addressLine1: updateAddressDto.addressLine1 ?? address.addressLine1,
      addressLine2:
        updateAddressDto.addressLine2 !== undefined
          ? updateAddressDto.addressLine2
          : address.addressLine2,
      tumbon: updateAddressDto.tumbon !== undefined ? updateAddressDto.tumbon : address.tumbon,
      amphoe,
      district: amphoe,
      province: updateAddressDto.province ?? address.province,
      postalCode: updateAddressDto.postalCode ?? address.postalCode,
      label: updateAddressDto.label ?? address.label,
      isDefault: updateAddressDto.isDefault ?? address.isDefault,
    });
    return this.addressRepository.save(address);
  }

  // Delete address
  async deleteAddress(customerId: string, addressId: string): Promise<void> {
    const address = await this.addressRepository.findOne({
      where: { id: addressId, customerId },
    });

    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Address not found',
      });
    }

    await this.addressRepository.softDelete(addressId);
  }

  // Set default address
  async setDefaultAddress(customerId: string, addressId: string): Promise<SavedAddress> {
    const address = await this.addressRepository.findOne({
      where: { id: addressId, customerId },
    });

    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Address not found',
      });
    }

    // Unset other default addresses
    await this.addressRepository.update({ customerId, isDefault: true }, { isDefault: false });

    address.isDefault = true;
    return this.addressRepository.save(address);
  }

  async getPaymentMethods(customerId: string): Promise<SavedPaymentMethod[]> {
    return this.paymentMethodRepository.find({
      where: { customerId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async addPaymentMethod(
    customerId: string,
    input: {
      omiseCardToken: string;
      lastFour: string;
      brand: string;
      expiryMonth: number;
      expiryYear: number;
      isDefault?: boolean;
    },
  ): Promise<SavedPaymentMethod> {
    if (input.isDefault) {
      await this.paymentMethodRepository.update(
        { customerId, isDefault: true },
        { isDefault: false },
      );
    }

    const method = this.paymentMethodRepository.create({
      customerId,
      type: PaymentMethodType.CREDIT_CARD,
      omiseCardToken: input.omiseCardToken,
      lastFour: input.lastFour,
      brand: input.brand,
      expiryMonth: input.expiryMonth,
      expiryYear: input.expiryYear,
      isDefault: input.isDefault ?? false,
    });

    return this.paymentMethodRepository.save(method);
  }

  async deletePaymentMethod(customerId: string, methodId: string): Promise<void> {
    const method = await this.paymentMethodRepository.findOne({
      where: { id: methodId, customerId },
    });
    if (!method) {
      throw new NotFoundException({
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found',
      });
    }
    await this.paymentMethodRepository.softDelete(methodId);
  }

  async setDefaultPaymentMethod(customerId: string, methodId: string): Promise<SavedPaymentMethod> {
    const method = await this.paymentMethodRepository.findOne({
      where: { id: methodId, customerId },
    });
    if (!method) {
      throw new NotFoundException({
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Payment method not found',
      });
    }

    await this.paymentMethodRepository.update(
      { customerId, isDefault: true },
      { isDefault: false },
    );

    method.isDefault = true;
    return this.paymentMethodRepository.save(method);
  }

  async requestAccountDeletion(customerId: string): Promise<void> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }

    if (customer.deletionRequestedAt) {
      throw new BadRequestException({
        code: 'DELETION_ALREADY_REQUESTED',
        message: 'Account deletion has already been requested',
      });
    }

    customer.isActive = false;
    customer.deletionRequestedAt = new Date();
    await this.customerRepository.save(customer);
  }

  async reactivateAccount(reactivationToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    customer: Customer;
  }> {
    let payload: ReactivationJwtPayload;
    try {
      payload = this.jwtService.verify<ReactivationJwtPayload>(reactivationToken);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REACTIVATION_TOKEN',
        message: 'Invalid or expired reactivation token',
      });
    }

    if (payload.purpose !== 'reactivation' || !payload.sub) {
      throw new UnauthorizedException({
        code: 'INVALID_REACTIVATION_TOKEN',
        message: 'Invalid or expired reactivation token',
      });
    }

    const customer = await this.customerRepository.findOne({
      where: { id: payload.sub },
    });

    if (!customer || !isPendingDeletion(customer)) {
      throw new BadRequestException({
        code: 'ACCOUNT_NOT_PENDING_DELETION',
        message: 'Account is not pending deletion',
      });
    }

    if (isDeletionRetentionExpired(customer.deletionRequestedAt!)) {
      await this.finalizeExpiredDeletion(customer);
      throw new BadRequestException({
        code: 'DELETION_RETENTION_EXPIRED',
        message: 'Account deletion grace period has expired',
      });
    }

    customer.deletionRequestedAt = null;
    customer.isActive = true;
    customer.lastLoginAt = new Date();
    await this.customerRepository.save(customer);

    const { accessToken, refreshToken } = await this.generateTokens({
      sub: customer.id,
      phone: customer.phone,
      role: 'customer',
    });

    return { accessToken, refreshToken, customer };
  }

  async finalizeExpiredDeletion(customer: Customer): Promise<void> {
    await this.customerRepo.finalizeDeletion(customer.id);
  }

  private async generateTokens(
    payload: Omit<JwtPayload, 'type'>,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, type: 'access' },
        {
          expiresIn: this.configService.get<string>('jwt.accessTokenExpiresIn'),
        },
      ),
      this.jwtService.signAsync(
        { ...payload, type: 'refresh' },
        {
          expiresIn: this.configService.get<string>('jwt.refreshTokenExpiresIn'),
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }
}
