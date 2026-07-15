import { SearchAnalyticsService } from './search-analytics.service';
import type { Repository } from 'typeorm';
import type { SearchEvent } from '../../database/entities/search-event.entity';
import type { SearchSuggestionEvent } from '../../database/entities/search-suggestion-event.entity';

describe('SearchAnalyticsService', () => {
  const saveSearchEvent = jest.fn();
  const searchEventRepository = {
    save: saveSearchEvent,
    createQueryBuilder: jest.fn(),
  } as unknown as Repository<SearchEvent>;

  const searchSuggestionEventRepository = {
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  } as unknown as Repository<SearchSuggestionEvent>;

  const service = new SearchAnalyticsService(
    searchEventRepository,
    searchSuggestionEventRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty recovery suggestions for blank query', async () => {
    await expect(service.suggestRecoveryQueries('   ')).resolves.toEqual([]);
  });

  it('records search events asynchronously', async () => {
    saveSearchEvent.mockResolvedValue({});

    service.recordSearchEvent({
      query: 'cat food',
      resultCount: 0,
      latencyMs: 12,
      sessionId: 'session-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveSearchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'cat food',
        resultCount: 0,
        latencyMs: 12,
        sessionId: 'session-1',
      }),
    );
  });

  it('exports csv with utf-8 bom and header row', async () => {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          query: 'dog',
          resultCount: 3,
          latencyMs: 20,
          sessionId: 'abc',
          suggestionClicked: false,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    };

    (searchEventRepository.createQueryBuilder as jest.Mock).mockReturnValue(queryBuilder);

    const csv = await service.exportCsv();
    expect(
      csv.startsWith(
        '\uFEFFquery,result_count,latency_ms,session_id,suggestion_clicked,created_at',
      ),
    ).toBe(true);
    expect(csv).toContain('dog,3,20,abc,false');
  });

  it('defaults analytics window to seven days', () => {
    const now = new Date('2026-07-10T00:00:00.000Z');
    const range = service.resolveDateRange(undefined, now);
    expect(range.toDate).toEqual(now);
    expect(range.fromDate.toISOString()).toBe('2026-07-03T00:00:00.000Z');
  });
});
