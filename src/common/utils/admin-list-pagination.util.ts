export const ADMIN_LIST_DEFAULT_LIMIT = 20;
export const ADMIN_LIST_MAX_LIMIT = 100;

export function normalizeAdminListPage(page?: number): number {
  if (page == null || !Number.isFinite(page)) return 1;
  return Math.max(1, Math.floor(page));
}

export function normalizeAdminListLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) return ADMIN_LIST_DEFAULT_LIMIT;
  return Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export function buildAdminListPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
