import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  data: T;
  meta?: {
    timestamp: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => {
        // If data is already formatted (has success field), return as is
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }

        // Otherwise, wrap in standard response format
        const response: Response<T> = {
          success: true,
          data,
          meta: {
            timestamp: new Date().toISOString(),
          },
        };

        // If data has pagination info, include it
        if (data && typeof data === 'object' && 'items' in data && 'pagination' in data) {
          response.data = data.items;
          response.meta!.pagination = data.pagination;
        }

        return response;
      }),
    );
  }
}
