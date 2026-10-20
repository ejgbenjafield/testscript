import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  computeRunStats,
  testCaseStatus,
  type RunDetail,
  type RunResult,
  type RunTestCase,
  type SnapshotStep,
  type StepResult,
} from '@testscript/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useCan, useMe, useOrg } from '../lib/queries';
import { formatDateTime, timeAgo } from '../lib/format';
import { ConfirmButton, ErrorNote, Loading, toast } from '../components/ui';
import { CaseStatusBadge, CaseStatusDot, ResultStrip, RunStatusBadge, StatCounts } from '../components/results';
import { Files } from '../components/Files';

export function RunPage() {
  const { runId = '' } = useParams();
  const org = useOrg();
  const queryClient = useQueryClient();
  const canRecord = useCan('recordResults');
  const key = keys.run(runId);

  const run = useQuery({
    queryKey: key,
    queryFn: () => api.get<RunDetail>(`/runs/${runId}`),
    // While a run is live, check every 10 seconds so people testing together see each other's results.
    refetchInterval: (q) => (q.state.data?.status === 'in_progress' ? 10_000 : false),
  });
  const [selected, setSelected] = useState<string | null>(null);

  const resultsByStep = useMemo(() => {
    const m = new Map<string, RunResult>();
    for (const r of run.data?.results ?? []) m.set(r.stepId, r);
    return m;
  }, [run.data?.results]);

  useEffect(() => {
    if (!run.data || selected) return;
    // Open the first test case that still has work to do.
    const first =
      run.data.testCases.find((c) => c.steps.some((s) => !resultsByStep.has(s.id))) ?? run.data.testCases[0];
    if (first) setSelected(first.testCaseId);
  }, [run.data, selected, resultsByStep]);

  const finish = useMutation({
    mutationFn: (status: 'completed' | 'abandoned') => api.patch<RunDetail>(`/runs/${runId}`, { status }),
    onSuccess: (r) => {
      queryClient.setQueryData(key, r);
      queryClient.invalidateQueries({ queryKey: keys.runs(r.suiteId) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
      toast.info(r.status === 'completed' ? 'Run completed' : 'Run abandoned');
    },
  });

  if (run.isPending) return <Loading />;
  if (run.isError) return <ErrorNote error={run.error} />;
  const r = run.data;
  const live = r.status === 'in_progress';
  const editable = live && canRecord;
  const stats = computeRunStats(r.stats.total, r.results.map((x) => x.result));
  const current = r.testCases.find((c) => c.testCaseId === selected) ?? r.testCases[0];
  const currentIndex = current ? r.testCases.indexOf(current) : -1;

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link className="link" to={`/${org.slug}/projects/${r.projectId}`}>{r.projectName}</Link> /{' '}
        <Link className="link" to={`/${org.slug}/suites/${r.suiteId}`}>{r.suiteRef} {r.suiteName}</Link> / Run
      </nav>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold">
            {r.name} <RunStatusBadge status={r.status} />
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Started {formatDateTime(r.startedAt)}
            {r.startedBy && ` by ${r.startedBy.name || r.startedBy.email}`}
            {r.finishedAt && `. Finished ${timeAgo(r.finishedAt)}`}.
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <ConfirmButton
              label="Abandon run"
              className="btn-secondary"
              title="Abandon this run?"
              body="It will be kept in the history as abandoned and left out of pass-rate trends. Results can't be changed afterwards."
              confirmLabel="Abandon run"
              onConfirm={() => finish.mutateAsync('abandoned')}
            />
            <button
              className="btn-primary"
              disabled={finish.isPending}
              onClick={() => {
                if (stats.untested > 0 && !window.confirm(`${stats.untested} steps haven't been run. Complete the run anyway?`)) return;
                finish.mutate('completed');
              }}
            >
              Complete run
            </button>
          </div>
        )}
      </header>

      <div className="mt-5 space-y-2">
        <ResultStrip stats={stats} className="h-3" />
        <StatCounts stats={stats} />
      </div>
      <ErrorNote error={finish.error} className="mt-3" />
      {!live && (
        <p className="mt-4 rounded-md bg-canvas px-3 py-2 text-sm text-ink-soft">
          This run is {r.status === 'completed' ? 'complete' : 'abandoned'}, so its results are read-only.
        </p>
      )}
      {live && !canRecord && (
        <p className="mt-4 rounded-md bg-canvas px-3 py-2 text-sm text-ink-soft">You have view access, so you can follow along but not record results.</p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_1fr]">
        <aside aria-label="Test cases in this run">
          <ol className="overflow-hidden rounded-lg border border-line bg-white lg:sticky lg:top-20">
            {r.testCases.map((c, i) => {
              const status = testCaseStatus(
                c.steps.map((s) => s.id),
                Object.fromEntries(c.steps.map((s) => [s.id, resultsByStep.get(s.id)?.result])),
              );
              const active = c.testCaseId === current?.testCaseId;
              return (
                <li key={c.testCaseId} className="border-b border-line last:border-b-0">
                  <button
                    onClick={() => setSelected(c.testCaseId)}
                    aria-current={active ? 'step' : undefined}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm ${active ? 'bg-cobalt-50 font-semibold' : 'hover:bg-canvas'}`}
                  >
                    <CaseStatusDot status={status} />
                    <span className="w-5 shrink-0 tabular-nums text-ink-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {current && (
          <section aria-labelledby="case-title">
            <CasePanel
              run={r}
              testCase={current}
              resultsByStep={resultsByStep}
              editable={editable}
              onNext={currentIndex < r.testCases.length - 1 ? () => setSelected(r.testCases[currentIndex + 1].testCaseId) : undefined}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function CasePanel({
  run,
  testCase,
  resultsByStep,
  editable,
  onNext,
}: {
  run: RunDetail;
  testCase: RunTestCase;
  resultsByStep: Map<string, RunResult>;
  editable: boolean;
  onNext?: () => void;
}) {
  const status = testCaseStatus(
    testCase.steps.map((s) => s.id),
    Object.fromEntries(testCase.steps.map((s) => [s.id, resultsByStep.get(s.id)?.result])),
  );
  const done = testCase.steps.every((s) => resultsByStep.has(s.id));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="case-title" className="text-xl font-semibold">{testCase.name}</h2>
        <CaseStatusBadge status={status} />
      </div>
      {testCase.description && <p className="mt-1 max-w-[70ch] whitespace-pre-wrap text-ink-muted">{testCase.description}</p>}
      <CaseFields testCase={testCase} />
      <ol className="mt-5 space-y-3">
        {testCase.steps.map((step, i) => (
          <StepCard
            key={step.id}
            run={run}
            testCaseId={testCase.testCaseId}
            step={step}
            index={i}
            result={resultsByStep.get(step.id)}
            editable={editable}
          />
        ))}
      </ol>
      {onNext && done && (
        <div className="mt-5 flex justify-end">
          <button className="btn-primary" onClick={onNext}>Next test case</button>
        </div>
      )}
    </div>
  );
}

const BUTTONS: Array<{ value: StepResult; label: string; on: string; off: string }> = [
  { value: 'pass', label: 'Pass', on: 'bg-pass text-white border-pass', off: 'border-pass/40 text-pass hover:bg-pass-soft' },
  { value: 'fail', label: 'Fail', on: 'bg-fail text-white border-fail', off: 'border-fail/40 text-fail hover:bg-fail-soft' },
  { value: 'skip', label: 'Skip', on: 'bg-skip text-white border-skip', off: 'border-skip/40 text-skip hover:bg-skip-soft' },
];

function StepCard({
  run,
  testCaseId,
  step,
  index,
  result,
  editable,
}: {
  run: RunDetail;
  testCaseId: string;
  step: SnapshotStep;
  index: number;
  result: RunResult | undefined;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const me = useMe();
  const key = keys.run(run.id);
  const [notes, setNotes] = useState(result?.notes ?? '');
  useEffect(() => setNotes(result?.notes ?? ''), [result?.notes]);

  const patchResults = (fn: (results: RunResult[]) => RunResult[]) =>
    queryClient.setQueryData<RunDetail>(key, (prev) => (prev ? { ...prev, results: fn(prev.results) } : prev));

  // Each click is saved straight away. The screen updates first and rolls back if the save fails.
  const record = useMutation({
    mutationFn: (body: { result: StepResult; notes?: string | null }) =>
      api.post<RunResult>(`/runs/${run.id}/results`, { testCaseId, stepId: step.id, ...body }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<RunDetail>(key);
      patchResults((results) => {
        const existing = results.find((x) => x.stepId === step.id);
        const optimistic: RunResult = {
          id: existing?.id ?? `pending-${step.id}`,
          testCaseId,
          stepId: step.id,
          result: body.result,
          notes: body.notes !== undefined ? body.notes : existing?.notes ?? null,
          recordedAt: new Date().toISOString(),
          recordedBy: me.data ? { id: me.data.user.id, name: me.data.user.name, email: me.data.user.email } : null,
          attachments: existing?.attachments ?? [],
        };
        return [...results.filter((x) => x.stepId !== step.id), optimistic];
      });
      return { prev };
    },
    onError: (err, _b, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast.error(`Step ${index + 1} wasn't saved: ${errorMessage(err)}`);
    },
    onSuccess: (saved) => patchResults((results) => [...results.filter((x) => x.stepId !== step.id), saved]),
  });

  const clear = useMutation({
    mutationFn: () => api.delete(`/run-results/${result!.id}`),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<RunDetail>(key);
      patchResults((results) => results.filter((x) => x.stepId !== step.id));
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast.error(errorMessage(err));
    },
  });

  const value = result?.result;
  const saved = result && !result.id.startsWith('pending-');
  const tone = value === 'fail' ? 'border-fail/50' : value === 'pass' ? 'border-pass/40' : value === 'skip' ? 'border-skip/40' : 'border-line';

  return (
    <li className={`rounded-lg border bg-white p-4 ${tone}`}>
      <div className="grid gap-4 md:grid-cols-[2rem_1fr_auto]">
        <span className="text-lg font-semibold tabular-nums text-ink-faint">{index + 1}</span>
        <div className={`grid gap-3 ${step.details ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <div>
            <p className="text-xs font-medium text-ink-muted">Do this{step.ref && <span className="ml-2 text-ink-faint">{step.ref}</span>}</p>
            <p className="mt-0.5 whitespace-pre-wrap">{step.action}</p>
          </div>
          {step.details && (
            <div>
              <p className="text-xs font-medium text-ink-muted">Details to validate</p>
              <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">{step.details}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-ink-muted">Expect this</p>
            <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">{step.expectedResult || <span className="text-ink-faint">No expected result given</span>}</p>
          </div>
        </div>
        <div className="flex items-start gap-1.5" role="group" aria-label={`Result for step ${index + 1}`}>
          {BUTTONS.map((b) => (
            <button
              key={b.value}
              type="button"
              disabled={!editable}
              aria-pressed={value === b.value}
              onClick={() => (value === b.value ? saved && clear.mutate() : record.mutate({ result: b.value }))}
              className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-default ${
                value === b.value ? b.on : editable ? b.off : 'border-line text-ink-faint'
              }`}
              title={value === b.value && editable ? 'Click again to clear' : undefined}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {value === 'fail' || result?.notes || (result?.attachments.length ?? 0) > 0 ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4 md:ml-12">
          {editable ? (
            <div>
              <label className="label" htmlFor={`notes-${step.id}`}>What happened?</label>
              <textarea
                id={`notes-${step.id}`}
                className="field"
                rows={2}
                value={notes}
                placeholder="Describe what you saw instead"
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  if (value && notes !== (result?.notes ?? '')) record.mutate({ result: value, notes: notes || null });
                }}
              />
            </div>
          ) : (
            result?.notes && <p className="whitespace-pre-wrap text-sm"><span className="text-ink-muted">Notes: </span>{result.notes}</p>
          )}
          {saved && result ? (
            <Files
              entityType="run_result"
              entityId={result.id}
              files={result.attachments}
              canUpload={editable}
              canDelete={(f) => editable && f.uploader?.id === me.data?.user.id}
              onUploaded={(file) =>
                patchResults((results) => results.map((x) => (x.id === result.id ? { ...x, attachments: [...x.attachments, file] } : x)))
              }
              onDelete={async (file) => {
                await api.delete(`/attachments/${file.id}`);
                patchResults((results) =>
                  results.map((x) => (x.id === result.id ? { ...x, attachments: x.attachments.filter((a) => a.id !== file.id) } : x)),
                );
              }}
            />
          ) : (
            editable && <p className="text-xs text-ink-faint">Saving…</p>
          )}
        </div>
      ) : null}

      {result?.recordedBy && saved && (
        <p className="mt-3 text-xs text-ink-faint md:ml-12">
          Recorded by {result.recordedBy.name || result.recordedBy.email}, {timeAgo(result.recordedAt)}
        </p>
      )}
    </li>
  );
}

/** Pre-condition, system and import details for the test case, as they were when the run started. */
function CaseFields({ testCase }: { testCase: RunTestCase }) {
  const fields = [
    { label: 'Test case ID', value: testCase.ref },
    { label: 'Pre-condition', value: testCase.precondition },
    { label: 'System', value: testCase.system },
    { label: 'Import via', value: testCase.importVia },
    { label: 'Import definition', value: testCase.importDefinition },
  ].filter((f) => f.value);
  if (fields.length === 0) return null;
  return (
    <dl className="mt-3 grid max-w-3xl gap-x-6 gap-y-1 rounded-md bg-canvas px-4 py-3 text-sm sm:grid-cols-[9rem_1fr]">
      {fields.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-ink-muted">{f.label}</dt>
          <dd className="whitespace-pre-wrap text-ink-soft">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
