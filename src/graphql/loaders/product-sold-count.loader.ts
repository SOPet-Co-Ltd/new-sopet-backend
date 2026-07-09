import DataLoader from 'dataloader';
import { AnalyticsService } from '../../modules/analytics/analytics.service';

export function createProductSoldCountLoader(
  analyticsService: AnalyticsService,
): DataLoader<string, number> {
  return new DataLoader<string, number>(async (productIds) => {
    return analyticsService.getProductSoldCounts([...productIds]);
  });
}
