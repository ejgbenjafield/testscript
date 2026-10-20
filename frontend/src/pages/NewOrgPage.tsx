import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Org } from '@testscript/shared';
import { api } from '../lib/api';
import { keys, useMe } from '../lib/queries';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNote } from '../components/ui';

export function NewOrgPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const { logout } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const create = useMutation({
    mutationFn: () => api.post<Org>('/orgs', { name, slug: slug || undefined }),
    onSuccess: async (org) => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      navigate(`/${org.slug}/dashboard`);
    },
  });
  const hasOrgs = (me.data?.orgs.length ?? 0) > 0;

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <div className="flex items-center gap-2 font-bold">
        <img src="/favicon.svg" alt="" className="h-6 w-6" /> TestScript
      </div>
      <h1 className="mt-10 text-2xl font-semibold">Create an organisation</h1>
      <p className="mt-2 text-ink-muted">
        An organisation holds your team's projects, test areas, test cases and run results. You can invite people once it's set up.
      </p>
      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="org-name">Name</label>
          <input id="org-name" className="field" required maxLength={200} value={name} placeholder="Acme QA" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="org-slug">Web address (optional)</label>
          <div className="flex items-center gap-1 text-sm text-ink-muted">
            <span>{window.location.host}/</span>
            <input
              id="org-slug"
              className="field"
              value={slug}
              placeholder="acme-qa"
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              title="Lowercase letters, numbers and hyphens"
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </div>
          <p className="mt-1 text-xs text-ink-faint">Leave blank to make one from the name.</p>
        </div>
        <ErrorNote error={create.error} />
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={create.isPending || !name.trim()}>
            Create organisation
          </button>
          {hasOrgs ? (
            <Link to="/" className="btn-ghost">Cancel</Link>
          ) : (
            <button type="button" className="btn-ghost" onClick={logout}>Sign out</button>
          )}
        </div>
      </form>
      {!hasOrgs && (
        <p className="mt-10 text-sm text-ink-muted">
          Joining an existing team? Ask an admin to invite {me.data?.user.email ?? 'you'}, then open the link they send.
        </p>
      )}
    </main>
  );
}
