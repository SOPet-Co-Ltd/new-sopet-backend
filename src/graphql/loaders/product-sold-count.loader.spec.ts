import { createProductSoldCountLoader } from './product-sold-count.loader';
import { AnalyticsService } from '../../modules/analytics/analytics.service';

describe('createProductSoldCountLoader', () => {
  it('returns counts in the same order as requested keys, zero-filling missing ids', async () => {
    const getProductSoldCounts = jest.fn().mockResolvedValue([5, 0, 12]);
    const analyticsService = {
      getProductSoldCounts,
    } as unknown as AnalyticsService;

    const loader = createProductSoldCountLoader(analyticsService);

    const result = await loader.loadMany(['p1', 'p2', 'p3']);

    expect(getProductSoldCounts).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
    expect(result).toEqual([5, 0, 12]);
  });
});
