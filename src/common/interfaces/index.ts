export interface JwtPayload {
  sub: string; // user/customer ID
  email?: string;
  phone?: string;
  role?: 'admin' | 'vendor' | 'customer';
  storeId?: string;
  /** Session version; must match entity token_version (SOPET-M-01). */
  ver: number;
  type: 'access' | 'refresh';
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
