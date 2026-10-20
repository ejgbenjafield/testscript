import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPassRate, type Dashboard, type Project, type RunSummary } from '@testscript/shared';
import { api } from '../lib/api';
import { keys, useCan, useOrg } from '../lib/queries';
import { plural, timeAgo } from '../lib/format';
import { EmptyState, ErrorNote, Loading, Modal } from '../components/ui';
import { ResultStrip, RunStatusBadge, StatCounts, TrendBars } from '../components/results';

export function DashboardPage() {
  const org = useOrg();
  const canEdit = useCan('editContent');
  const [creating, setCreating] = useState(false);
  const dash = useQuery({ queryKey: keys.dashboard(org.id), queryFn: () => api.get<Dashboard>(`/orgs/${org.id}/dashboard`) });

  if (dash.isPending) return <Loading />;
  if (dash.isError) return <ErrorNote error={dash.error} />;
  const d = dash.data;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="mt-1 text-ink-muted">
            {plural(d.totals.projects, 'project')}, {plural(d.totals.suites, 'test area')}, {plural(d.totals.testCases, 'test case')}
          </p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            New project
          </button>
        )}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Figure label="Pass rate, last 30 days" value={formatPassRate(d.totals.passRateLast30Days)} />
        <Figure label="Runs, last 30 days" value={String(d.totals.runsLast30Days)} />
        <Figure label="Runs in progress" value={String(d.activeRuns.length)} />
        <Figure label="Test cases" value={String(d.totals.testCases)} />
      </dl>

      {d.activeRuns.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">In progress</h2>
          <RunList runs={d.activeRuns} />
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Projects</h2>
        {d.projects.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No projects yet"
              action={canEdit && <button className="btn-primary" onClick={() => setCreating(true)}>Create your first project</button>}
            >
              {canEdit
                ? 'A project groups the test areas for one product or app. Start with one, then add test areas and test cases inside it.'
                : 'Projects will appear here once a manager creates one.'}
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
            {d.projects.map((p) => (
              <li key={p.id}>
                <Link to={`/${org.slug}/projects/${p.id}`} className="flex items-center gap-6 px-5 py-4 hover:bg-canvas/60">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      <span className="mr-2 tabular-nums text-ink-faint">{p.number}</span>
                      {p.name}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">
                      {plural(p.suiteCount, 'test area')}, {plural(p.testCaseCount, 'test case')}. Last run {timeAgo(p.lastRunAt)}.
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <TrendBars trend={p.trend} />
                  </div>
                  <span className="w-12 text-right text-lg font-semibold tabular-nums">
                    {formatPassRate(p.trend.at(-1)?.passRate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.recentRuns.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Recent runs</h2>
          <RunList runs={d.recentRuns} />
        </section>
      )}

      <NewProjectModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-5 py-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function RunList({ runs }: { runs: Array<RunSummary & { suiteName?: string; suiteRef?: string; projectName?: string }> }) {
  const org = useOrg();
  return (
    <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
      {runs.map((r) => (
        <li key={r.id}>
          <Link to={`/${org.slug}/runs/${r.id}`} className="grid gap-2 px-5 py-3.5 hover:bg-canvas/60 sm:grid-cols-[1fr_14rem] sm:items-center sm:gap-6">
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                <span className="truncate font-medium">{r.name}</span>
                <RunStatusBadge status={r.status} />
              </p>
              <p className="mt-0.5 truncate text-sm text-ink-muted">
                {r.projectName && `${r.projectName} / ${r.suiteRef} ${r.suiteName}. `}
                Started {timeAgo(r.startedAt)}
                {r.startedBy && ` by ${r.startedBy.name || r.startedBy.email}`}
              </p>
            </div>
            <div className="space-y-1.5">
              <ResultStrip stats={r.stats} />
              <StatCounts stats={r.stats} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const org = useOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Project>(`/orgs/${org.id}/projects`, { name, description: description || null }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
      setName('');
      setDescription('');
      onClose();
      navigate(`/${org.slug}/projects/${p.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="new-project" disabled={create.isPending || !name.trim()}>
            Create project
          </button>
        </>
      }
    >
      <form
        id="new-project"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="project-name">Name</label>
          <input id="project-name" className="field" autoFocus required value={name} placeholder="Customer web app" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="project-desc">Description (optional)</label>
          <textarea id="project-desc" className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}
