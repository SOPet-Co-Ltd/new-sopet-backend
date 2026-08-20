export interface JwtPayload {
  sub: string; // user/customer ID
  email?: string;
  phone?: string;
  role?: 'admin' | 'vendor' | 'customer';
  storeId?: string;
  /** Admin-only claim — frontend should force change-password UX. */
  mustChangePassword?: boolean;
  type: 'access' | 'refresh';
  /** Present on refresh tokens — stored in Redis for one-time rotation. */
  jti?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
