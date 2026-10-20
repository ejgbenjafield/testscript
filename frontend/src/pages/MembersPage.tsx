import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Invitation,
  type Member,
  type Page,
  type Role,
} from '@testscript/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useCan, useMe, useOrg } from '../lib/queries';
import { formatDate } from '../lib/format';
import { Avatar, ConfirmButton, ErrorNote, Loading, Modal, toast } from '../components/ui';

/** One row of the grid: either a member, or someone invited who hasn't joined yet. */
type Row =
  | { kind: 'member'; key: string; name: string; email: string; role: Role; date: string; member: Member }
  | { kind: 'invite'; key: string; name: string; email: string; role: Role; date: string; invitation: Invitation };

export function MembersPage() {
  const org = useOrg();
  const me = useMe();
  const canManage = useCan('manageMembers');
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [inviting, setInviting] = useState(false);

  const members = useQuery({
    queryKey: keys.members(org.id),
    queryFn: () => api.get<Page<Member>>(`/orgs/${org.id}/members?limit=200`),
  });
  const invitations = useQuery({
    queryKey: keys.invitations(org.id),
    queryFn: () => api.get<Page<Invitation>>(`/orgs/${org.id}/invitations`),
    enabled: canManage,
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch<Member>(`/orgs/${org.id}/members/${userId}`, { role }),
    onSuccess: (m) => {
      queryClient.invalidateQueries({ queryKey: keys.members(org.id) });
      queryClient.invalidateQueries({ queryKey: keys.org(org.slug) });
      toast.info(`${m.name || m.email} is now ${ROLE_LABELS[m.role].toLowerCase()}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [
      ...(members.data?.data ?? []).map((m): Row => ({
        kind: 'member', key: m.userId, name: m.name || '', email: m.email, role: m.role, date: m.joinedAt, member: m,
      })),
      ...(invitations.data?.data ?? []).map((i): Row => ({
        kind: 'invite', key: i.id, name: '', email: i.email, role: i.role, date: i.expiresAt, invitation: i,
      })),
    ];
    const q = filter.trim().toLowerCase();
    return list
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
      .filter((r) => !roleFilter || r.role === roleFilter)
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [members.data, invitations.data, filter, roleFilter]);

  const memberCount = members.data?.data.length ?? 0;
  const pendingCount = invitations.data?.data.length ?? 0;
  // Admins can't change owners or make owners; only owners can.
  const assignable = (current: Role): Role[] =>
    ROLES.filter((r) => org.role === 'owner' || (r !== 'owner' && current !== 'owner'));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="mt-1 text-ink-muted">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
            {canManage && pendingCount > 0 && `, ${pendingCount} waiting to join`}
          </p>
        </div>
        {canManage && <button className="btn-primary" onClick={() => setInviting(true)}>Invite people</button>}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="member-filter">Filter by name or email</label>
        <input id="member-filter" type="search" className="field max-w-xs" placeholder="Filter by name or email" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="sr-only" htmlFor="role-filter">Filter by role</label>
        <select id="role-filter" className="field w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | '')}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      {members.isPending ? (
        <Loading />
      ) : members.isError ? (
        <ErrorNote error={members.error} className="mt-4" />
      ) : (
        <div className="panel mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas/60 text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Email</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Joined</th>
                {canManage && <th scope="col" className="px-4 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-muted">Nobody matches that filter.</td></tr>
              )}
              {rows.map((r) => {
                if (r.kind === 'invite') {
                  const inv = r.invitation;
                  return (
                    <tr key={r.key} className="text-ink-soft">
                      <td className="px-4 py-2.5 text-ink-faint">Not joined yet</td>
                      <td className="px-4 py-2.5">{inv.email}</td>
                      <td className="px-4 py-2.5">{ROLE_LABELS[inv.role]}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-skip-soft px-1.5 py-0.5 text-xs font-medium text-skip">Invited</span>
                        <span className="ml-2 text-xs text-ink-faint">expires {formatDate(inv.expiresAt)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-ink-faint">–</td>
                      <td className="px-4 py-2.5 text-right">
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
                          Cancel invite
                        </ConfirmButton>
                      </td>
                    </tr>
                  );
                }
                const m = r.member;
                const isMe = m.userId === me.data?.user.id;
                const editable = canManage && (org.role === 'owner' || m.role !== 'owner');
                return (
                  <tr key={r.key}>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={m.name} email={m.email} url={m.avatarUrl} size={26} />
                        <span className="font-medium">{m.name || m.email.split('@')[0]}</span>
                        {isMe && <span className="text-ink-faint">(you)</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{m.email}</td>
                    <td className="px-4 py-2.5">
                      {editable ? (
                        <>
                          <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.email}</label>
                          <select
                            id={`role-${m.userId}`}
                            className="field w-auto py-1"
                            value={m.role}
                            disabled={changeRole.isPending}
                            onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                          >
                            {assignable(m.role).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                          </select>
                        </>
                      ) : (
                        ROLE_LABELS[m.role]
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-pass-soft px-1.5 py-0.5 text-xs font-medium text-pass">Active</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{formatDate(m.joinedAt)}</td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        {editable && !isMe && (
                          <ConfirmButton
                            label={`Remove ${m.email}`}
                            title={`Remove ${m.name || m.email}?`}
                            body="They'll lose access straight away. Their past results stay in the run history."
                            confirmLabel="Remove member"
                            onConfirm={async () => {
                              await api.delete(`/orgs/${org.id}/members/${m.userId}`);
                              queryClient.invalidateQueries({ queryKey: keys.members(org.id) });
                              queryClient.invalidateQueries({ queryKey: keys.org(org.slug) });
                            }}
                          >
                            Remove
                          </ConfirmButton>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="mt-4 text-sm text-ink-muted">
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

      <LeaveOrg />
      {canManage && <InviteModal open={inviting} onClose={() => setInviting(false)} />}
    </div>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('tester');
  const [sent, setSent] = useState<Invitation | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<Invitation>(`/orgs/${org.id}/members/invite`, { email, role }),
    onSuccess: (inv) => {
      setSent(inv);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: keys.invitations(org.id) });
    },
  });
  const close = () => {
    setSent(null);
    invite.reset();
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite people"
      footer={
        sent ? (
          <>
            <button className="btn-secondary" onClick={() => setSent(null)}>Invite someone else</button>
            <button className="btn-primary" onClick={close}>Done</button>
          </>
        ) : (
          <>
            <button className="btn-secondary" onClick={close}>Cancel</button>
            <button className="btn-primary" form="invite-form" disabled={invite.isPending}>Send invitation</button>
          </>
        )
      }
    >
      {sent?.inviteUrl ? (
        <div className="space-y-3">
          <p className="text-sm">
            {sent.emailSent
              ? `We emailed ${sent.email}. You can also share this link with them:`
              : `Email isn't set up, so send this link to ${sent.email} yourself. It works once and expires in 7 days.`}
          </p>
          <div className="flex gap-2">
            <input readOnly aria-label="Invitation link" className="field" value={sent.inviteUrl} onFocus={(e) => e.target.select()} />
            <button
              className="btn-secondary shrink-0"
              onClick={() => navigator.clipboard.writeText(sent.inviteUrl!).then(() => toast.info('Link copied'))}
            >
              Copy link
            </button>
          </div>
        </div>
      ) : (
        <form id="invite-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
          <div>
            <label className="label" htmlFor="invite-email">Email</label>
            <input id="invite-email" type="email" required autoFocus className="field" value={email} placeholder="name@company.com" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="invite-role">Role</label>
            <select id="invite-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <p className="mt-1 text-xs text-ink-muted">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
          <ErrorNote error={invite.error} />
        </form>
      )}
    </Modal>
  );
}

function LeaveOrg() {
  const org = useOrg();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <section className="mt-12 border-t border-line pt-8">
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
