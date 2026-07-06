export interface JwtPayload {
  sub: string; // user/customer ID
  email?: string;
  phone?: string;
  role?: 'admin' | 'vendor' | 'customer';
  storeId?: string;
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
