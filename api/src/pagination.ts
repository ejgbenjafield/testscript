import type { Page } from '@testscript/shared';

/** Turn `limit + 1` fetched rows into a page with a cursor for the next one. */
export function toPage<R extends { id: string }, T>(rows: R[], limit: number, map: (r: R) => T): Page<T> {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return { data: slice.map(map), nextCursor: hasMore ? slice[slice.length - 1].id : null };
}

export const iso = (d: Date | string | null | undefined) =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();
