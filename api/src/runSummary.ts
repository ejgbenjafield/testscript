import type { RunStats, RunSummary } from '@testscript/shared';
import { iso } from './pagination';

/** SELECT for run summaries with result counts. Alias `r` is runs. */
export const RUN_SUMMARY_SQL = `
  SELECT r.id, r.suite_id, r.name, r.status, r.started_at, r.finished_at, r.total_steps,
         u.id AS starter_id, u.name AS starter_name, u.email AS starter_email,
         COALESCE(rs.passed, 0) AS passed, COALESCE(rs.failed, 0) AS failed, COALESCE(rs.skipped, 0) AS skipped
    FROM runs r
    LEFT JOIN users u ON u.id = r.started_by
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE result = 'pass')::int AS passed,
             count(*) FILTER (WHERE result = 'fail')::int AS failed,
             count(*) FILTER (WHERE result = 'skip')::int AS skipped
        FROM run_results WHERE run_id = r.id
    ) rs ON true`;

export function statsFromRow(r: { total_steps: number; passed: number; failed: number; skipped: number }): RunStats {
  const passed = Number(r.passed);
  const failed = Number(r.failed);
  const skipped = Number(r.skipped);
  const total = Number(r.total_steps);
  return {
    total,
    passed,
    failed,
    skipped,
    untested: Math.max(0, total - passed - failed - skipped),
    passRate: passed + failed === 0 ? null : passed / (passed + failed),
  };
}

export function mapRunSummary(r: any): RunSummary {
  return {
    id: r.id,
    suiteId: r.suite_id,
    name: r.name,
    status: r.status,
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    startedBy: r.starter_id ? { id: r.starter_id, name: r.starter_name, email: r.starter_email } : null,
    stats: statsFromRow(r),
  };
}
