export const STEP_RESULTS = ['pass', 'fail', 'skip'] as const;
export type StepResult = (typeof STEP_RESULTS)[number];

export const RUN_STATUSES = ['in_progress', 'completed', 'abandoned'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type TestCaseStatus = 'untested' | 'in_progress' | 'pass' | 'fail' | 'skip';

export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  untested: number;
  /** passed / (passed + failed), or null when nothing has been passed or failed yet. */
  passRate: number | null;
}

/**
 * Status of one test case from its steps' results.
 * Any fail → fail. Otherwise any untested step → in_progress (or untested if
 * nothing recorded). All skipped → skip. Otherwise pass.
 */
export function testCaseStatus(
  stepIds: string[],
  resultsByStep: Map<string, StepResult> | Record<string, StepResult | undefined>,
): TestCaseStatus {
  const get = (id: string) =>
    resultsByStep instanceof Map ? resultsByStep.get(id) : resultsByStep[id];
  if (stepIds.length === 0) return 'untested';
  let recorded = 0;
  let skipped = 0;
  for (const id of stepIds) {
    const r = get(id);
    if (!r) continue;
    recorded++;
    if (r === 'fail') return 'fail';
    if (r === 'skip') skipped++;
  }
  if (recorded === 0) return 'untested';
  if (recorded < stepIds.length) return 'in_progress';
  if (skipped === stepIds.length) return 'skip';
  return 'pass';
}

export function computeRunStats(totalSteps: number, results: Iterable<StepResult>): RunStats {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r === 'pass') passed++;
    else if (r === 'fail') failed++;
    else if (r === 'skip') skipped++;
  }
  const untested = Math.max(0, totalSteps - passed - failed - skipped);
  const decided = passed + failed;
  return {
    total: totalSteps,
    passed,
    failed,
    skipped,
    untested,
    passRate: decided === 0 ? null : passed / decided,
  };
}

export function formatPassRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '–';
  return `${Math.round(rate * 100)}%`;
}
