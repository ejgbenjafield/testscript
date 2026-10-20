import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Attachment, Page, Project, RunDetail, RunSummary, Step, Suite, TestCase } from '@testscript/shared';
import { api, errorMessage, qs } from '../lib/api';
import { keys, useCan, useOrg } from '../lib/queries';
import { plural } from '../lib/format';
import { ConfirmButton, EmptyState, ErrorNote, InlineEdit, Loading, Modal, Tabs, toast } from '../components/ui';
import { SortableItem, SortableList } from '../components/Sortable';
import { Files } from '../components/Files';
import { RunList } from './DashboardPage';

type CasesPage = Page<TestCase>;

export function SuitePage() {
  const { suiteId = '' } = useParams();
  const org = useOrg();
  const canEdit = useCan('editContent');
  const canRun = useCan('runTests');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'cases' | 'history'>('cases');
  // Which test cases the run dialog starts with selected: 'all', a chosen few, or closed.
  const [starting, setStarting] = useState<'all' | string[] | null>(null);

  const suite = useQuery({ queryKey: keys.suite(suiteId), queryFn: () => api.get<Suite>(`/suites/${suiteId}`) });
  const project = useQuery({
    queryKey: keys.project(suite.data?.projectId ?? ''),
    queryFn: () => api.get<Project>(`/orgs/${org.id}/projects/${suite.data!.projectId}`),
    enabled: Boolean(suite.data),
  });
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<Suite, 'name' | 'description'>>) => api.patch<Suite>(`/suites/${suiteId}`, patch),
    onSuccess: (s) => {
      queryClient.setQueryData(keys.suite(suiteId), s);
      queryClient.invalidateQueries({ queryKey: keys.suites(s.projectId) });
    },
  });

  if (suite.isPending) return <Loading />;
  if (suite.isError) return <ErrorNote error={suite.error} />;
  const s = suite.data;

  return (
    <div className="mx-auto max-w-5xl">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link className="link" to={`/${org.slug}/dashboard`}>Dashboard</Link> /{' '}
        <Link className="link" to={`/${org.slug}/projects/${s.projectId}`}>{project.data?.name ?? s.projectName ?? 'Project'}</Link> / Test script
      </nav>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-baseline gap-3 text-2xl font-semibold">
            <span className="tabular-nums text-ink-faint">{s.ref}</span>
            <InlineEdit ariaLabel="test script name" value={s.name} disabled={!canEdit} onSave={(name) => update.mutateAsync({ name })} />
          </h1>
          <div className="mt-1 max-w-2xl text-ink-muted">
            <InlineEdit
              ariaLabel="test script description"
              multiline
              placeholder="Add a description"
              value={s.description ?? ''}
              disabled={!canEdit}
              onSave={(description) => update.mutateAsync({ description: description || null })}
            />
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <ConfirmButton
              label="Delete test script"
              className="btn-danger"
              title={`Delete ${s.name}?`}
              body="Its test cases will be removed from view. Run history for this test script stays available from the runs' own links."
              confirmLabel="Delete test script"
              onConfirm={async () => {
                await api.delete(`/suites/${s.id}`);
                queryClient.invalidateQueries({ queryKey: keys.suites(s.projectId) });
                queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
                toast.info(`Deleted ${s.name}`);
                navigate(`/${org.slug}/projects/${s.projectId}`);
              }}
            />
          )}
          {canRun && (
            <button className="btn-primary" disabled={s.testCaseCount === 0} onClick={() => setStarting('all')}>
              Start a run
            </button>
          )}
        </div>
      </div>

      <div className="mt-8">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'cases', label: `Test cases (${s.testCaseCount})` },
            { id: 'history', label: 'Run history' },
          ]}
        />
        <div className="mt-5">{tab === 'cases' ? <TestCases suite={s} onRun={canRun ? (id) => setStarting([id]) : undefined} /> : <RunHistory suiteId={s.id} />}</div>
      </div>

      <StartRunModal suite={s} initial={starting} onClose={() => setStarting(null)} />
    </div>
  );
}

// Test cases --------------------------------------------------------------------------

function TestCases({ suite, onRun }: { suite: Suite; onRun?: (testCaseId: string) => void }) {
  const canEdit = useCan('editContent');
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const focusId = params.get('case');
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusId ? [focusId] : []));
  const key = keys.testCases(suite.id);

  const cases = useQuery({
    queryKey: key,
    queryFn: () => api.get<CasesPage>(`/suites/${suite.id}/test-cases${qs({ includeSteps: true, limit: 500 })}`),
  });

  useEffect(() => {
    if (!focusId || !cases.data) return;
    setOpen((o) => new Set(o).add(focusId));
    requestAnimationFrame(() => document.getElementById(`case-${focusId}`)?.scrollIntoView({ block: 'center' }));
    params.delete('case');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, cases.data]);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post(`/suites/${suite.id}/test-cases/reorder`, { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<CasesPage>(key);
      if (prev) {
        const byId = new Map(prev.data.map((c) => [c.id, c]));
        queryClient.setQueryData<CasesPage>(key, { ...prev, data: ids.map((id) => byId.get(id)!).filter(Boolean) });
      }
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (cases.isPending) return <Loading />;
  if (cases.isError) return <ErrorNote error={cases.error} />;
  const list = cases.data.data;

  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <EmptyState title="No test cases yet">
          {canEdit
            ? 'Add a test case below, then give it steps: what the tester does, and what they should see.'
            : 'Test cases will appear here once a manager adds them.'}
        </EmptyState>
      ) : (
        <SortableList items={list} onReorder={(ids) => reorder.mutate(ids)}>
          <ol className="divide-y divide-line rounded-lg border border-line bg-white">
            {list.map((tc, i) => (
              <SortableItem key={tc.id} id={tc.id} disabled={!canEdit} className="bg-white first:rounded-t-lg last:rounded-b-lg">
                {(handle) => (
                  <TestCaseRow
                    index={i}
                    testCase={tc}
                    suite={suite}
                    handle={handle}
                    expanded={open.has(tc.id)}
                    onToggle={() => toggle(tc.id)}
                    onRun={onRun}
                  />
                )}
              </SortableItem>
            ))}
          </ol>
        </SortableList>
      )}
      {canEdit && <NewTestCase suite={suite} onCreated={(id) => setOpen((o) => new Set(o).add(id))} />}
    </div>
  );
}

function useInvalidateCases(suite: Suite) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: keys.testCases(suite.id) });
    queryClient.invalidateQueries({ queryKey: keys.suite(suite.id) });
  };
}

function TestCaseRow({
  index,
  testCase,
  suite,
  handle,
  expanded,
  onToggle,
  onRun,
}: {
  index: number;
  testCase: TestCase;
  suite: Suite;
  handle: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  onRun?: (testCaseId: string) => void;
}) {
  const canEdit = useCan('editContent');
  const invalidate = useInvalidateCases(suite);
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<TestCase, 'name' | 'description'>>) => api.patch<TestCase>(`/test-cases/${testCase.id}`, patch),
    onSuccess: invalidate,
  });
  const panelId = `case-panel-${testCase.id}`;

  return (
    <div id={`case-${testCase.id}`} className="scroll-mt-24">
      <div className="flex items-center gap-2 px-3 py-3">
        {handle}
        <span className="w-7 text-right text-sm tabular-nums text-ink-faint">{index + 1}</span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:bg-canvas"
          aria-label={expanded ? 'Hide steps' : 'Show steps'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1 font-medium">
          <InlineEdit ariaLabel="test case name" value={testCase.name} disabled={!canEdit} onSave={(name) => update.mutateAsync({ name })} />
        </div>
        <span className="shrink-0 text-sm text-ink-muted">{plural(testCase.stepCount, 'step')}</span>
        {onRun && testCase.stepCount > 0 && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onRun(testCase.id)} aria-label={`Run ${testCase.name} on its own`}>
            Run
          </button>
        )}
        {canEdit && (
          <ConfirmButton
            label={`Delete ${testCase.name}`}
            title={`Delete “${testCase.name}”?`}
            body="It will be removed from this test script. Runs that already included it keep their results."
            confirmLabel="Delete test case"
            onConfirm={async () => {
              await api.delete(`/test-cases/${testCase.id}`);
              invalidate();
            }}
          >
            Delete
          </ConfirmButton>
        )}
      </div>
      {expanded && (
        <div id={panelId} className="border-t border-line bg-canvas/50 px-4 pb-4 pt-3 sm:pl-[5.5rem]">
          <div className="mb-3 text-sm text-ink-muted">
            <InlineEdit
              ariaLabel="test case description"
              multiline
              placeholder="Add preconditions or notes for testers"
              value={testCase.description ?? ''}
              disabled={!canEdit}
              onSave={(description) => update.mutateAsync({ description: description || null })}
            />
          </div>
          <Steps testCase={testCase} suite={suite} />
        </div>
      )}
    </div>
  );
}

function Steps({ testCase, suite }: { testCase: TestCase; suite: Suite }) {
  const canEdit = useCan('editContent');
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCases(suite);
  const steps = testCase.steps ?? [];
  const key = keys.testCases(suite.id);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post(`/test-cases/${testCase.id}/steps/reorder`, { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<CasesPage>(key);
      if (prev) {
        queryClient.setQueryData<CasesPage>(key, {
          ...prev,
          data: prev.data.map((c) => {
            if (c.id !== testCase.id || !c.steps) return c;
            const byId = new Map(c.steps.map((s) => [s.id, s]));
            return { ...c, steps: ids.map((id, position) => ({ ...byId.get(id)!, position })) };
          }),
        });
      }
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast.error(errorMessage(err));
    },
    onSettled: invalidate,
  });

  return (
    <div>
      {steps.length > 0 && (
        <div className="hidden grid-cols-[1.5rem_1.5rem_1fr_1fr_3.5rem] gap-3 px-1 pb-1 text-xs font-medium text-ink-muted md:grid">
          <span />
          <span />
          <span>Action</span>
          <span>Expected result</span>
          <span />
        </div>
      )}
      <SortableList items={steps} onReorder={(ids) => reorder.mutate(ids)}>
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <SortableItem key={step.id} id={step.id} disabled={!canEdit} className="rounded-md border border-line bg-white">
              {(handle) => <StepRow step={step} index={i} handle={handle} onChanged={invalidate} />}
            </SortableItem>
          ))}
        </ol>
      </SortableList>
      {canEdit && <NewStep testCase={testCase} onAdded={invalidate} />}
      {!canEdit && steps.length === 0 && <p className="text-sm text-ink-faint">No steps yet.</p>}
    </div>
  );
}

function StepRow({ step, index, handle, onChanged }: { step: Step; index: number; handle: React.ReactNode; onChanged: () => void }) {
  const canEdit = useCan('editContent');
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (patch: Partial<Pick<Step, 'action' | 'expectedResult'>>) => api.patch<Step>(`/steps/${step.id}`, patch),
    onSuccess: onChanged,
  });
  const fileKey = keys.attachments('step', step.id);
  const files = useQuery({
    queryKey: fileKey,
    queryFn: () => api.get<Page<Attachment>>(`/attachments${qs({ entityType: 'step', entityId: step.id })}`),
    enabled: (step.attachmentCount ?? 0) > 0,
  });
  const refreshFiles = () => {
    queryClient.invalidateQueries({ queryKey: fileKey });
    onChanged();
  };

  return (
    <div className="px-2 py-2">
      <div className="grid grid-cols-[1.5rem_1.5rem_1fr] items-start gap-x-3 gap-y-2 md:grid-cols-[1.5rem_1.5rem_1fr_1fr_3.5rem]">
        <span className="pt-0.5">{handle}</span>
        <span className="pt-1 text-right text-sm tabular-nums text-ink-faint">{index + 1}.</span>
        <div className="text-sm">
          <InlineEdit ariaLabel={`step ${index + 1} action`} multiline value={step.action} disabled={!canEdit} onSave={(action) => update.mutateAsync({ action })} />
        </div>
        <div className="col-start-3 text-sm text-ink-soft md:col-start-auto">
          <span className="text-xs text-ink-muted md:hidden">Expected: </span>
          <InlineEdit
            ariaLabel={`step ${index + 1} expected result`}
            multiline
            placeholder="Add expected result"
            value={step.expectedResult ?? ''}
            disabled={!canEdit}
            onSave={(expectedResult) => update.mutateAsync({ expectedResult: expectedResult || null })}
          />
        </div>
        {canEdit && (
          <div className="col-start-3 md:col-start-auto md:text-right">
            <ConfirmButton
              label={`Delete step ${index + 1}`}
              title={`Delete step ${index + 1}?`}
              body="Later steps move up to fill the gap."
              confirmLabel="Delete step"
              onConfirm={async () => {
                await api.delete(`/steps/${step.id}`);
                onChanged();
              }}
            >
              Delete
            </ConfirmButton>
          </div>
        )}
      </div>
      {(canEdit || (step.attachmentCount ?? 0) > 0) && (
        <div className="mt-2 pl-[3.75rem]">
          <Files
            compact
            entityType="step"
            entityId={step.id}
            files={files.data?.data ?? []}
            canUpload={canEdit}
            canDelete={() => canEdit}
            onUploaded={refreshFiles}
            onDelete={async (f) => {
              await api.delete(`/attachments/${f.id}`);
              refreshFiles();
            }}
          />
        </div>
      )}
    </div>
  );
}

function NewStep({ testCase, onAdded }: { testCase: TestCase; onAdded: () => void }) {
  const [action, setAction] = useState('');
  const [expected, setExpected] = useState('');
  const add = useMutation({
    mutationFn: () => api.post<Step>(`/test-cases/${testCase.id}/steps`, { action, expectedResult: expected || null }),
    onSuccess: () => {
      setAction('');
      setExpected('');
      onAdded();
      document.getElementById(`new-step-${testCase.id}`)?.focus();
    },
  });
  return (
    <form
      className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto] md:pl-[3.75rem]"
      onSubmit={(e) => {
        e.preventDefault();
        if (action.trim()) add.mutate();
      }}
    >
      <label className="sr-only" htmlFor={`new-step-${testCase.id}`}>New step action</label>
      <input id={`new-step-${testCase.id}`} className="field" placeholder="What the tester does" value={action} onChange={(e) => setAction(e.target.value)} />
      <label className="sr-only" htmlFor={`new-step-exp-${testCase.id}`}>Expected result</label>
      <input id={`new-step-exp-${testCase.id}`} className="field" placeholder="What they should see" value={expected} onChange={(e) => setExpected(e.target.value)} />
      <button className="btn-secondary" disabled={add.isPending || !action.trim()}>Add step</button>
      {add.error ? <ErrorNote error={add.error} className="md:col-span-3" /> : null}
    </form>
  );
}

function NewTestCase({ suite, onCreated }: { suite: Suite; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const invalidate = useInvalidateCases(suite);
  const create = useMutation({
    mutationFn: () => api.post<TestCase>(`/suites/${suite.id}/test-cases`, { name }),
    onSuccess: (tc) => {
      setName('');
      onCreated(tc.id);
      invalidate();
    },
  });
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate();
      }}
    >
      <label className="sr-only" htmlFor="new-case">New test case name</label>
      <input id="new-case" className="field max-w-md" placeholder="New test case, e.g. Pay with a saved card" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn-secondary shrink-0" disabled={create.isPending || !name.trim()}>Add test case</button>
      {create.error ? <ErrorNote error={create.error} /> : null}
    </form>
  );
}

// Run history ---------------------------------------------------------------------------

function RunHistory({ suiteId }: { suiteId: string }) {
  const runs = useQuery({
    queryKey: keys.runs(suiteId),
    queryFn: () => api.get<Page<RunSummary>>(`/suites/${suiteId}/runs?limit=100`),
  });
  if (runs.isPending) return <Loading />;
  if (runs.isError) return <ErrorNote error={runs.error} />;
  if (runs.data.data.length === 0) {
    return <EmptyState title="No runs yet">Start a run to work through this test script's test cases and record what passes and fails.</EmptyState>;
  }
  return <RunList runs={runs.data.data} />;
}

function StartRunModal({ suite, initial, onClose }: { suite: Suite; initial: 'all' | string[] | null; onClose: () => void }) {
  const org = useOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = initial !== null;
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const cases = useQuery({
    queryKey: keys.testCases(suite.id),
    queryFn: () => api.get<CasesPage>(`/suites/${suite.id}/test-cases${qs({ includeSteps: true, limit: 500 })}`),
    enabled: open,
  });
  // Only test cases with steps can be run.
  const runnable = (cases.data?.data ?? []).filter((c) => c.stepCount > 0);

  useEffect(() => {
    if (!open || !cases.data) return;
    setSelected(new Set(initial === 'all' ? runnable.map((c) => c.id) : initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cases.data]);

  const all = runnable.length > 0 && runnable.every((c) => selected.has(c.id));
  const start = useMutation({
    mutationFn: () =>
      api.post<RunDetail>(`/suites/${suite.id}/runs`, {
        name: name.trim() || undefined,
        // Leave the list out when everything is ticked, so the run includes the whole test script.
        testCaseIds: all ? undefined : [...selected],
      }),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: keys.runs(suite.id) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
      queryClient.setQueryData(keys.run(run.id), run);
      setName('');
      onClose();
      navigate(`/${org.slug}/runs/${run.id}`);
    },
  });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Run ${suite.ref} ${suite.name}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="start-run" disabled={start.isPending || selected.size === 0}>
            {all ? 'Start run' : `Run ${plural(selected.size, 'test case')}`}
          </button>
        </>
      }
    >
      <form id="start-run" className="space-y-4" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
        <p className="text-sm text-ink-muted">
          The run uses the test cases and steps as they are now. Later edits to the test script won't change it.
        </p>
        <div>
          <label className="label" htmlFor="run-name">Name (optional)</label>
          <input id="run-name" className="field" value={name} placeholder="Release 2.4 regression" onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset>
          <div className="flex items-center justify-between">
            <legend className="label mb-0">Test cases to run</legend>
            {runnable.length > 1 && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setSelected(all ? new Set() : new Set(runnable.map((c) => c.id)))}
              >
                {all ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>
          {cases.isPending ? (
            <Loading />
          ) : runnable.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">None of the test cases have steps yet.</p>
          ) : (
            <ul className="mt-2 max-h-64 divide-y divide-line overflow-auto rounded-md border border-line">
              {runnable.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-canvas">
                    <input type="checkbox" className="h-4 w-4 accent-cobalt-600" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-ink-muted">{plural(c.stepCount, 'step')}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <ErrorNote error={start.error} />
      </form>
    </Modal>
  );
}
