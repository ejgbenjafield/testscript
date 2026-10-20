import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Invitation,
  type Member,
  type Org,
  type Page,
  type Role,
} from '@testscript/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useCan, useMe, useOrg } from '../lib/queries';
import { formatDate } from '../lib/format';
import { Avatar, ConfirmButton, ErrorNote, Loading, toast } from '../components/ui';

export function SettingsPage() {
  const canManage = useCan('manageMembers');
  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <h1 className="text-2xl font-semibold">Members and settings</h1>
      {canManage && <OrgDetails />}
      <Members />
      {canManage && <Invitations />}
      <LeaveOrg />
    </div>
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

function Members() {
  const org = useOrg();
  const me = useMe();
  const canManage = useCan('manageMembers');
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: keys.members(org.id),
    queryFn: () => api.get<Page<Member>>(`/orgs/${org.id}/members?limit=200`),
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch<Member>(`/orgs/${org.id}/members/${userId}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.members(org.id) });
      queryClient.invalidateQueries({ queryKey: keys.org(org.slug) });
      toast.info('Role updated');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const assignable = (target: Member): Role[] =>
    ROLES.filter((r) => org.role === 'owner' || (r !== 'owner' && target.role !== 'owner'));

  return (
    <section>
      <h2 className="text-lg font-semibold">Members</h2>
      {members.isPending ? (
        <Loading />
      ) : members.isError ? (
        <ErrorNote error={members.error} />
      ) : (
        <ul className="panel mt-3 divide-y divide-line">
          {members.data.data.map((m) => {
            const isMe = m.userId === me.data?.user.id;
            const editable = canManage && (org.role === 'owner' || m.role !== 'owner');
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Avatar name={m.name} email={m.email} url={m.avatarUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.name || m.email} {isMe && <span className="font-normal text-ink-faint">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-ink-muted">{m.email}. Joined {formatDate(m.joinedAt)}</p>
                </div>
                {editable ? (
                  <>
                    <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.email}</label>
                    <select
                      id={`role-${m.userId}`}
                      className="field w-auto"
                      value={m.role}
                      disabled={changeRole.isPending}
                      onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                    >
                      {assignable(m).map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                    {!isMe && (
                      <ConfirmButton
                        label={`Remove ${m.email}`}
                        title={`Remove ${m.name || m.email}?`}
                        body="They'll lose access straight away. Their past results stay in the run history."
                        confirmLabel="Remove member"
                        onConfirm={async () => {
                          await api.delete(`/orgs/${org.id}/members/${m.userId}`);
                          queryClient.invalidateQueries({ queryKey: keys.members(org.id) });
                        }}
                      >
                        Remove
                      </ConfirmButton>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-ink-soft">{ROLE_LABELS[m.role]}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <details className="mt-3 text-sm text-ink-muted">
        <summary className="cursor-pointer">What each role can do</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr]">
          {ROLES.map((r) => (
            <div key={r} className="contents">
              <dt className="font-medium text-ink-soft">{ROLE_LABELS[r]}</dt>
              <dd>{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function Invitations() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('tester');
  const [lastLink, setLastLink] = useState<Invitation | null>(null);

  const pending = useQuery({
    queryKey: keys.invitations(org.id),
    queryFn: () => api.get<Page<Invitation>>(`/orgs/${org.id}/invitations`),
  });
  const invite = useMutation({
    mutationFn: () => api.post<Invitation>(`/orgs/${org.id}/members/invite`, { email, role }),
    onSuccess: (inv) => {
      setLastLink(inv);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: keys.invitations(org.id) });
      if (inv.emailSent) toast.info(`Invitation emailed to ${inv.email}`);
    },
  });

  return (
    <section>
      <h2 className="text-lg font-semibold">Invite people</h2>
      <form className="panel mt-3 flex flex-wrap items-end gap-3 p-5" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" required className="field" value={email} placeholder="name@company.com" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="invite-role">Role</label>
          <select id="invite-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.filter((r) => r !== 'owner').map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={invite.isPending}>Send invitation</button>
        {invite.error ? <ErrorNote error={invite.error} className="w-full" /> : null}
      </form>

      {lastLink?.inviteUrl && (
        <div className="mt-3 rounded-lg border border-cobalt-100 bg-cobalt-50 p-4">
          <p className="text-sm">
            {lastLink.emailSent
              ? `We emailed ${lastLink.email}. You can also share this link with them:`
              : `Email isn't set up, so send this link to ${lastLink.email} yourself. It works once and expires in 7 days.`}
          </p>
          <div className="mt-2 flex gap-2">
            <input readOnly aria-label="Invitation link" className="field font-normal" value={lastLink.inviteUrl} onFocus={(e) => e.target.select()} />
            <button
              className="btn-secondary shrink-0"
              onClick={() => navigator.clipboard.writeText(lastLink.inviteUrl!).then(() => toast.info('Link copied'))}
            >
              Copy link
            </button>
          </div>
        </div>
      )}

      {pending.data && pending.data.data.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">Waiting to join</h3>
          <ul className="panel mt-2 divide-y divide-line">
            {pending.data.data.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{inv.email}</span>
                <span className="text-ink-soft">{ROLE_LABELS[inv.role]}</span>
                <span className="text-ink-muted">Expires {formatDate(inv.expiresAt)}</span>
                <ConfirmButton
                  label={`Cancel invitation for ${inv.email}`}
                  title={`Cancel the invitation for ${inv.email}?`}
                  body="The link they were sent will stop working."
                  confirmLabel="Cancel invitation"
                  onConfirm={async () => {
                    await api.delete(`/orgs/${org.id}/invitations/${inv.id}`);
                    queryClient.invalidateQueries({ queryKey: keys.invitations(org.id) });
                  }}
                >
                  Cancel
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LeaveOrg() {
  const org = useOrg();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <section className="border-t border-line pt-8">
      <h2 className="text-lg font-semibold">Leave {org.name}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        You'll lose access to its projects and results.{org.role === 'owner' && ' Make someone else an owner first.'}
      </p>
      <div className="mt-3">
        <ConfirmButton
          label="Leave organisation"
          className="btn-danger"
          title={`Leave ${org.name}?`}
          body="You'll need a new invitation to come back."
          confirmLabel="Leave organisation"
          onConfirm={async () => {
            await api.delete(`/orgs/${org.id}/members/${me.data!.user.id}`);
            await queryClient.invalidateQueries({ queryKey: keys.me });
            navigate('/');
          }}
        />
      </div>
    </section>
  );
}
