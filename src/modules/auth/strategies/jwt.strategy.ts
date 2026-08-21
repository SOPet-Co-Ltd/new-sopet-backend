import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../../../common/interfaces';
import { Customer } from '../../../database/entities/customer.entity';
import { User } from '../../../database/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
      issuer: configService.get<string>('jwt.issuer'),
      audience: configService.get<string>('jwt.audience'),
    });
  }

  async validate(payload: JwtPayload) {
    const tokenVersion = payload.ver ?? 0;

    if (payload.role === 'customer') {
      const customer = await this.customerRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'tokenVersion'],
      });
      if (!customer || (customer.tokenVersion ?? 0) !== tokenVersion) {
        throw new UnauthorizedException('Invalid or revoked token');
      }
    } else if (payload.role === 'admin' || payload.role === 'vendor') {
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'tokenVersion'],
      });
      if (!user || (user.tokenVersion ?? 0) !== tokenVersion) {
        throw new UnauthorizedException('Invalid or revoked token');
      }
    }

    return {
      id: payload.sub,
      email: payload.email,
      phone: payload.phone,
      role: payload.role,
      storeId: payload.storeId,
      ver: tokenVersion,
    };
  }
}
