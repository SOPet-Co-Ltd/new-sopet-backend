/**
 * Re-ingest review_images that still store remote (non-CDN) URLs into R2/MinIO.
 *
 * Usage:
 *   yarn backfill:review-images
 *   yarn backfill:review-images --dry-run
 *   yarn backfill:review-images --limit=50
 *
 * Safe to re-run: rows already under our public `reviews/` prefix are skipped.
 * Failed downloads are logged and left unchanged so the rest of the batch continues.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReviewsService } from '../src/modules/reviews/reviews.service';

function parseArgs(argv: string[]): { dryRun: boolean; limit?: number } {
  let dryRun = false;
  let limit: number | undefined;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    const limitMatch = /^--limit=(\d+)$/.exec(arg);
    if (limitMatch) {
      limit = Number.parseInt(limitMatch[1], 10);
    }
  }

  return { dryRun, limit };
}

async function main(): Promise<void> {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const reviewsService = app.get(ReviewsService);
    console.log(
      `Backfilling remote review images${dryRun ? ' (dry-run)' : ''}${
        limit ? ` (limit=${limit})` : ''
      }…`,
    );

    const result = await reviewsService.backfillRemoteReviewImagesToStorage({ dryRun, limit });

    console.log(
      JSON.stringify(
        {
          scanned: result.scanned,
          skippedAlreadyStored: result.skippedAlreadyStored,
          updated: result.updated,
          failed: result.failed,
          failures: result.failures,
        },
        null,
        2,
      ),
    );

    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Review image backfill failed:', error);
  process.exit(1);
});
