import { Injectable } from '@nestjs/common';

@Injectable()
export class RrfEngine {
  merge(lists: string[][], k: number): string[] {
    const scores = new Map<string, number>();

    for (const list of lists) {
      list.forEach((id, index) => {
        const rank = index + 1;
        scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
      });
    }

    return [...scores.entries()]
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      })
      .map(([id]) => id);
  }

  scoreMap(lists: string[][], k: number): Map<string, number> {
    const scores = new Map<string, number>();

    for (const list of lists) {
      list.forEach((id, index) => {
        const rank = index + 1;
        scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
      });
    }

    return scores;
  }
}
