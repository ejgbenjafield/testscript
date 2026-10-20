import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Area, Org, Page } from '@testscript/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useCan, useOrg } from '../lib/queries';
import { ErrorNote, FullPageMessage, InlineEdit, Loading, toast } from '../components/ui';

/** Organisation-wide settings. Admins and owners only. */
export function SettingsPage() {
  const org = useOrg();
  const isAdmin = useCan('editOrg');
  if (!isAdmin) {
    return (
      <FullPageMessage title="Settings are for admins">
        Ask an admin if something needs changing.{' '}
        <Link className="link" to={`/${org.slug}/dashboard`}>Back to the dashboard</Link>
      </FullPageMessage>
    );
  }
  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-ink-muted">Changes here apply across the whole organisation.</p>
      </div>
      <Areas />
      <OrgDetails />
    </div>
  );
}

function Areas() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const listKey = [...keys.areas(org.id), 'all'];
  const areas = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<Page<Area>>(`/orgs/${org.id}/areas?includeArchived=true`),
  });
  const refresh = () => {
    // Also refreshes the dropdown used when adding test areas, and renamed test areas.
    queryClient.invalidateQueries({ queryKey: keys.areas(org.id) });
    queryClient.invalidateQueries({ queryKey: ['suites'] });
    queryClient.invalidateQueries({ queryKey: ['suite'] });
    queryClient.invalidateQueries({ queryKey: keys.dashboard(org.id) });
  };
  const add = useMutation({
    mutationFn: () => api.post<Area>(`/orgs/${org.id}/areas`, { name }),
    onSuccess: (a) => {
      setName('');
      refresh();
      toast.info(`Added ${a.name}`);
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; archived?: boolean }) =>
      api.patch<Area>(`/orgs/${org.id}/areas/${id}`, patch),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const list = areas.data?.data ?? [];
  const active = list.filter((a) => !a.archived);
  const archived = list.filter((a) => a.archived);

  return (
    <section>
      <h2 className="text-lg font-semibold">Test areas</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        The list people choose from when they add a test area to a project. Renaming an area renames it everywhere it's used. Archiving
        removes it from the list without touching test areas that already use it.
      </p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <label className="sr-only" htmlFor="new-area">New area name</label>
        <input id="new-area" className="field max-w-sm" placeholder="New area, e.g. Payroll" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary shrink-0" disabled={add.isPending || !name.trim()}>Add area</button>
      </form>
      <ErrorNote error={add.error} className="mt-2 max-w-md" />

      {areas.isPending ? (
        <Loading />
      ) : areas.isError ? (
        <ErrorNote error={areas.error} className="mt-4" />
      ) : (
        <div className="panel mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas/60 text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Area</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Used in</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-muted">No areas yet. Add the first one above.</td></tr>
              )}
              {[...active, ...archived].map((a) => (
                <tr key={a.id} className={a.archived ? 'text-ink-faint' : ''}>
                  <td className="px-4 py-2.5 font-medium">
                    <InlineEdit ariaLabel={`name of ${a.name}`} value={a.name} onSave={(next) => update.mutateAsync({ id: a.id, name: next })} />
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">
                    {a.usageCount === 0 ? 'Not used yet' : `${a.usageCount} ${a.usageCount === 1 ? 'project' : 'projects'}`}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.archived ? (
                      <span className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium text-ink-muted">Archived</span>
                    ) : (
                      <span className="rounded bg-pass-soft px-1.5 py-0.5 text-xs font-medium text-pass">In use</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      className="btn-ghost btn-sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: a.id, archived: !a.archived })}
                    >
                      {a.archived ? 'Restore' : 'Archive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OrgDetails() {
  const org = useOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const save = useMutation({
    mutationFn: () => api.patch<Org>(`/orgs/${org.id}`, { name, slug }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: keys.me });
      queryClient.setQueryData(keys.org(updated.slug), updated);
      toast.info('Organisation saved');
      if (updated.slug !== org.slug) navigate(`/${updated.slug}/settings`, { replace: true });
      else queryClient.invalidateQueries({ queryKey: keys.org(org.slug) });
    },
  });
  const changed = name.trim() !== org.name || slug !== org.slug;
  return (
    <section>
      <h2 className="text-lg font-semibold">Organisation</h2>
      <form className="panel mt-3 grid gap-4 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div>
          <label className="label" htmlFor="org-name">Name</label>
          <input id="org-name" className="field" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="org-slug">Web address</label>
          <div className="flex items-center gap-1 text-sm text-ink-muted">
            <span>{window.location.host}/</span>
            <input id="org-slug" className="field" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          </div>
          <p className="mt-1 text-xs text-ink-faint">Changing this breaks old links to your pages.</p>
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button className="btn-primary" disabled={!changed || save.isPending}>Save changes</button>
          <span className="text-sm text-ink-muted">Plan: {org.plan}, {org.seatCount} {org.seatCount === 1 ? 'seat' : 'seats'}</span>
        </div>
        {save.error ? <ErrorNote error={save.error} className="sm:col-span-2" /> : null}
      </form>
    </section>
  );
}
