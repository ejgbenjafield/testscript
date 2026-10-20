import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Page, Project, Suite } from '@testscript/shared';
import { api } from '../lib/api';
import { keys, useCan, useOrg } from '../lib/queries';
import { plural, timeAgo } from '../lib/format';
import { ConfirmButton, EmptyState, ErrorNote, InlineEdit, Loading, Modal, toast } from '../components/ui';
import { ResultStrip, RunStatusBadge } from '../components/results';

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const org = useOrg();
  const canEdit = useCan('editContent');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const project = useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => api.get<Project>(`/orgs/${org.id}/projects/${projectId}`),
  });
  const suites = useQuery({
    queryKey: keys.suites(projectId),
    queryFn: () => api.get<Page<Suite>>(`/projects/${projectId}/suites?limit=200`),
  });

  const update = useMutation({
    mutationFn: (patch: Partial<Pick<Project, 'name' | 'description'>>) =>
      api.patch<Project>(`/orgs/${org.id}/projects/${projectId}`, patch),
    onSuccess: (p) => {
      queryClient.setQueryData(keys.project(projectId), p);
      queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
    },
  });

  if (project.isPending) return <Loading />;
  if (project.isError) return <ErrorNote error={project.error} />;
  const p = project.data;

  return (
    <div className="mx-auto max-w-5xl">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <Link className="link" to={`/${org.slug}/dashboard`}>Dashboard</Link> / Project
      </nav>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-baseline gap-3 text-2xl font-semibold">
            <span className="tabular-nums text-ink-faint">{p.number}</span>
            <InlineEdit ariaLabel="project name" value={p.name} disabled={!canEdit} onSave={(name) => update.mutateAsync({ name })} />
          </h1>
          <div className="mt-1 max-w-2xl text-ink-muted">
            <InlineEdit
              ariaLabel="project description"
              multiline
              placeholder="Add a description"
              value={p.description ?? ''}
              disabled={!canEdit}
              onSave={(description) => update.mutateAsync({ description: description || null })}
            />
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <ConfirmButton
              label="Delete project"
              className="btn-danger"
              title={`Delete ${p.name}?`}
              body="Its test scripts and test cases will be removed from view. Past runs and their results are kept."
              confirmLabel="Delete project"
              onConfirm={async () => {
                await api.delete(`/orgs/${org.id}/projects/${p.id}`);
                queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
                toast.info(`Deleted ${p.name}`);
                navigate(`/${org.slug}/dashboard`);
              }}
            />
            <button className="btn-primary" onClick={() => setCreating(true)}>New test script</button>
          </div>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Test scripts</h2>
        {suites.isPending ? (
          <Loading />
        ) : suites.isError ? (
          <ErrorNote error={suites.error} />
        ) : suites.data.data.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No test scripts yet"
              action={canEdit && <button className="btn-primary" onClick={() => setCreating(true)}>Create a test script</button>}
            >
              A test script is a set of test cases you run together, such as “Checkout” or “Release smoke test”.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
            {suites.data.data.map((s) => (
              <li key={s.id}>
                <Link to={`/${org.slug}/suites/${s.id}`} className="grid gap-3 px-5 py-4 hover:bg-canvas/60 sm:grid-cols-[1fr_16rem] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <span className="mr-2 tabular-nums text-ink-faint">{s.ref}</span>
                      {s.name}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">
                      {plural(s.testCaseCount, 'test case')}
                      {s.description && `. ${s.description}`}
                    </p>
                  </div>
                  {s.lastRun ? (
                    <div className="space-y-1.5">
                      <ResultStrip stats={s.lastRun.stats} />
                      <p className="flex items-center gap-2 text-xs text-ink-muted">
                        Last run {timeAgo(s.lastRun.startedAt)} <RunStatusBadge status={s.lastRun.status} />
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-faint">Not run yet</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewSuiteModal projectId={p.id} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewSuiteModal({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const org = useOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Suite>(`/projects/${projectId}/suites`, { name, description: description || null }),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: keys.suites(projectId) });
      queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
      setName('');
      setDescription('');
      onClose();
      navigate(`/${org.slug}/suites/${s.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New test script"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" form="new-suite" disabled={create.isPending || !name.trim()}>Create test script</button>
        </>
      }
    >
      <form id="new-suite" className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div>
          <label className="label" htmlFor="suite-name">Name</label>
          <input id="suite-name" className="field" autoFocus required value={name} placeholder="Checkout" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="suite-desc">Description (optional)</label>
          <textarea id="suite-desc" className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <ErrorNote error={create.error} />
      </form>
    </Modal>
  );
}
