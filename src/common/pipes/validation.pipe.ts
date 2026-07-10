import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype, type }: ArgumentMetadata) {
    // Custom params (e.g. GraphQL @Parent/@Context/@Info decorators) are not
    // request inputs and carry no validation metadata; validating them trips
    // class-validator's forbidUnknownValues check. Only validate real args.
    if (type === 'custom' || !metatype || !this.toValidate(metatype)) {
      return value;
    }

    if (value === undefined || value === null) {
      return value;
    }

    const object = plainToInstance(metatype, value);
    if (object === undefined || object === null) {
      return value;
    }

    const errors = await validate(object);

    if (errors.length > 0) {
      const details = errors.map((error) => ({
        field: error.property,
        message: Object.values(error.constraints || {}).join(', '),
        constraints: error.constraints,
      }));

      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details,
      });
    }

    return object;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
