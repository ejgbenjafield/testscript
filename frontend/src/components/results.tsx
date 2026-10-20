import type { RunStats, RunStatus, TestCaseStatus } from '@testscript/shared';
import { formatPassRate } from '@testscript/shared';
import { formatDate } from '../lib/format';

const SEGMENTS = [
  { key: 'passed', label: 'passed', className: 'bg-pass' },
  { key: 'failed', label: 'failed', className: 'bg-fail' },
  { key: 'skipped', label: 'skipped', className: 'bg-skip' },
  { key: 'untested', label: 'not run', className: 'bg-untested' },
] as const;

/** A run as a single bar: green passed, red failed, amber skipped, grey not yet run. */
export function ResultStrip({ stats, className = 'h-2' }: { stats: RunStats; className?: string }) {
  const total = Math.max(stats.total, 1);
  const label = SEGMENTS.map((s) => `${stats[s.key]} ${s.label}`).join(', ');
  return (
    <div role="img" aria-label={label} title={label} className={`flex w-full overflow-hidden rounded-full bg-untested-soft ${className}`}>
      {SEGMENTS.map((s) =>
        stats[s.key] > 0 ? (
          <span key={s.key} className={s.className} style={{ width: `${(stats[s.key] / total) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}

export function StatCounts({ stats }: { stats: RunStats }) {
  return (
    <span className="flex flex-wrap gap-x-3 text-xs text-ink-muted">
      <span><b className="font-semibold text-pass">{stats.passed}</b> passed</span>
      <span><b className="font-semibold text-fail">{stats.failed}</b> failed</span>
      <span><b className="font-semibold text-skip">{stats.skipped}</b> skipped</span>
      {stats.untested > 0 && <span><b className="font-semibold text-ink-soft">{stats.untested}</b> not run</span>}
    </span>
  );
}

/** Last few finished runs as bars whose height is the pass rate. */
export function TrendBars({ trend }: { trend: Array<{ runId: string; passRate: number | null; finishedAt: string }> }) {
  const slots = [...Array(Math.max(0, 7 - trend.length)).fill(null), ...trend];
  const label = trend.length
    ? `Pass rate of the last ${trend.length} finished runs: ${trend.map((t) => formatPassRate(t.passRate)).join(', ')}`
    : 'No finished runs yet';
  return (
    <div role="img" aria-label={label} className="flex h-10 items-end gap-1">
      {slots.map((t, i) =>
        t ? (
          <span
            key={t.runId}
            title={`${formatPassRate(t.passRate)} on ${formatDate(t.finishedAt)}`}
            className={`w-2.5 rounded-sm ${rateColour(t.passRate)}`}
            style={{ height: `${Math.max(8, (t.passRate ?? 0) * 100)}%` }}
          />
        ) : (
          <span key={`empty-${i}`} className="h-1 w-2.5 rounded-sm bg-untested-soft" />
        ),
      )}
    </div>
  );
}

function rateColour(rate: number | null) {
  if (rate === null) return 'bg-untested';
  if (rate >= 0.9) return 'bg-pass';
  if (rate >= 0.6) return 'bg-skip';
  return 'bg-fail';
}

const CASE_STATUS: Record<TestCaseStatus, { label: string; className: string }> = {
  untested: { label: 'Not run', className: 'bg-untested-soft text-ink-muted' },
  in_progress: { label: 'In progress', className: 'bg-cobalt-50 text-cobalt-700' },
  pass: { label: 'Passed', className: 'bg-pass-soft text-pass' },
  fail: { label: 'Failed', className: 'bg-fail-soft text-fail' },
  skip: { label: 'Skipped', className: 'bg-skip-soft text-skip' },
};

export function CaseStatusBadge({ status }: { status: TestCaseStatus }) {
  const s = CASE_STATUS[status];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}

export function CaseStatusDot({ status }: { status: TestCaseStatus }) {
  const colour = { untested: 'bg-untested', in_progress: 'bg-cobalt-500', pass: 'bg-pass', fail: 'bg-fail', skip: 'bg-skip' }[status];
  return <span aria-label={CASE_STATUS[status].label} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colour}`} />;
}

const RUN_STATUS: Record<RunStatus, { label: string; className: string }> = {
  in_progress: { label: 'In progress', className: 'bg-cobalt-50 text-cobalt-700' },
  completed: { label: 'Completed', className: 'bg-canvas text-ink-soft' },
  abandoned: { label: 'Abandoned', className: 'bg-canvas text-ink-faint line-through' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = RUN_STATUS[status];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>;
}
