import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNABLE_ROLES,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  VIEWER_DESCRIPTION,
  can,
  describeRoles,
  normaliseRoles,
  type Invitation,
  type Member,
  type Page,
  type Project,
  type Role,
} from '@testscript/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useCan, useMe, useOrg } from '../lib/queries';
import { formatDate } from '../lib/format';
import { Avatar, ConfirmButton, ErrorNote, Loading, Modal, toast } from '../components/ui';

type RoleFilter = Role | 'viewer' | '';

/** The organisation's projects, for showing and choosing assignments. */
function useProjects(enabled = true) {
  const org = useOrg();
  return useQuery({
    queryKey: [...keys.projects(org.id), 'all'],
    queryFn: () => api.get<Page<Project>>(`/orgs/${org.id}/projects?limit=200`),
    enabled,
  });
}

export function MembersPage() {
  const org = useOrg();
  const me = useMe();
  const canManage = useCan('manageMembers');
  const canAssign = useCan('manageProjects');
  const isOwner = useCan('transferOwnership');
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('');
  const [inviting, setInviting] = useState(false);
  const [assigning, setAssigning] = useState<Member | null>(null);

  const members = useQuery({
    queryKey: keys.members(org.id),
    queryFn: () => api.get<Page<Member>>(`/orgs/${org.id}/members?limit=200`),
  });
  const invitations = useQuery({
    queryKey: keys.invitations(org.id),
    queryFn: () => api.get<Page<Invitation>>(`/orgs/${org.id}/invitations`),
    enabled: canManage,
  });
  const projects = useProjects();
  const projectName = useMemo(() => {
    const m = new Map((projects.data?.data ?? []).map((p) => [p.id, `${p.number} ${p.name}`]));
    return (id: string) => m.get(id);
  }, [projects.data]);

  const setRoles = useMutation({
    mutationFn: ({ userId, roles }: { userId: string; roles: Role[] }) =>
      api.patch<Member>(`/orgs/${org.id}/members/${userId}`, { roles }),
    onSuccess: (m) => {
      queryClient.invalidateQueries({ queryKey: keys.members(org.id) });
      queryClient.invalidateQueries({ queryKey: keys.org(org.slug) });
      toast.info(`${m.name || m.email}: ${describeRoles(m.roles)}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const matches = (name: string, email: string, roles: Role[]) => {
    const q = filter.trim().toLowerCase();
    if (q && !name.toLowerCase().includes(q) && !email.toLowerCase().includes(q)) return false;
    if (roleFilter === 'viewer') return roles.length === 0;
    if (roleFilter) return roles.includes(roleFilter);
    return true;
  };
  const memberRows = (members.data?.data ?? [])
    .filter((m) => matches(m.name ?? '', m.email, m.roles))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const inviteRows = (invitations.data?.data ?? []).filter((i) => matches('', i.email, i.roles));

  const memberCount = members.data?.data.length ?? 0;
  const pendingCount = invitations.data?.data.length ?? 0;
  const columns = 6 + ROLES.length;

  return (
    <div className="mx-auto max-w-7xl">
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
        <select id="role-filter" className="field w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          <option value="viewer">Viewers (no roles)</option>
        </select>
      </div>

      {members.isPending ? (
        <Loading />
      ) : members.isError ? (
        <ErrorNote error={members.error} className="mt-4" />
      ) : (
        <div className="panel mt-4 overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas/60 text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Email</th>
                {ROLES.map((r) => (
                  <th key={r} scope="col" className="px-2 py-2.5 text-center font-medium" title={ROLE_DESCRIPTIONS[r]}>
                    {ROLE_LABELS[r]}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5 font-medium">Projects</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Joined</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {memberRows.length + inviteRows.length === 0 && (
                <tr><td colSpan={columns} className="px-4 py-8 text-center text-ink-muted">Nobody matches that filter.</td></tr>
              )}

              {memberRows.map((m) => {
                const isMe = m.userId === me.data?.user.id;
                const targetIsOwner = m.roles.includes('owner');
                // Admins manage everyone except owners; owners manage everyone.
                const editable = canManage && (isOwner || !targetIsOwner);
                const seesAll = can(m.roles, 'seeAllProjects');
                const toggle = (role: Role) => {
                  const next = m.roles.includes(role) ? m.roles.filter((r) => r !== role) : [...m.roles, role];
                  setRoles.mutate({ userId: m.userId, roles: normaliseRoles(next) });
                };
                return (
                  <tr key={m.userId}>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={m.name} email={m.email} url={m.avatarUrl} size={26} />
                        <span className="font-medium">{m.name || m.email.split('@')[0]}</span>
                        {isMe && <span className="text-ink-faint">(you)</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{m.email}</td>
                    {ROLES.map((role) => {
                      const allowed = editable && (role !== 'owner' || isOwner);
                      return (
                        <td key={role} className="px-2 py-2.5 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-cobalt-600 disabled:opacity-60"
                            aria-label={`${ROLE_LABELS[role]} role for ${m.email}`}
                            checked={m.roles.includes(role)}
                            disabled={!allowed || setRoles.isPending}
                            onChange={() => toggle(role)}
                          />
                        </td>
                      );
                    })}
                    <td className="max-w-[16rem] px-4 py-2.5">
                      {seesAll ? (
                        <span className="text-ink-muted">All projects</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-ink-soft" title={m.projectIds.map(projectName).filter(Boolean).join(', ')}>
                            {m.projectIds.length === 0
                              ? <span className="text-ink-faint">None</span>
                              : m.projectIds.map(projectName).filter(Boolean).join(', ')}
                          </span>
                          {canAssign && (
                            <button className="btn-ghost btn-sm shrink-0" onClick={() => setAssigning(m)} aria-label={`Choose projects for ${m.email}`}>
                              Edit
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-pass-soft px-1.5 py-0.5 text-xs font-medium text-pass">Active</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{formatDate(m.joinedAt)}</td>
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
                  </tr>
                );
              })}

              {inviteRows.map((inv) => (
                <tr key={inv.id} className="text-ink-soft">
                  <td className="px-4 py-2.5 text-ink-faint">Not joined yet</td>
                  <td className="px-4 py-2.5">{inv.email}</td>
                  {ROLES.map((role) => (
                    <td key={role} className="px-2 py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 opacity-60"
                        aria-label={`${ROLE_LABELS[role]} role for ${inv.email}`}
                        checked={inv.roles.includes(role)}
                        disabled
                        readOnly
                      />
                    </td>
                  ))}
                  <td className="max-w-[16rem] truncate px-4 py-2.5">
                    {can(inv.roles, 'seeAllProjects')
                      ? 'All projects'
                      : inv.projectIds.map(projectName).filter(Boolean).join(', ') || <span className="text-ink-faint">None</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded bg-skip-soft px-1.5 py-0.5 text-xs font-medium text-skip">Invited</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-faint">Expires {formatDate(inv.expiresAt)}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RoleGuide />
      <LeaveOrg />
      {canManage && <InviteModal open={inviting} onClose={() => setInviting(false)} />}
      {assigning && <AssignProjectsModal member={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function RoleGuide() {
  return (
    <details className="mt-4 text-sm text-ink-muted">
      <summary className="cursor-pointer">What each role can do</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr]">
        {ROLES.map((r) => (
          <div key={r} className="contents">
            <dt className="font-medium text-ink-soft">{ROLE_LABELS[r]}</dt>
            <dd>{ROLE_DESCRIPTIONS[r]}</dd>
          </div>
        ))}
        <dt className="font-medium text-ink-soft">Viewer</dt>
        <dd>{VIEWER_DESCRIPTION}</dd>
      </dl>
      <p className="mt-2">Roles combine: tick as many as someone needs. Admins and owners see every project; everyone else sees only the projects they're assigned to.</p>
    </details>
  );
}

/** Tick boxes for a set of projects. */
function ProjectPicker({ selected, onChange, idPrefix }: { selected: Set<string>; onChange: (next: Set<string>) => void; idPrefix: string }) {
  const projects = useProjects();
  const list = projects.data?.data ?? [];
  if (projects.isPending) return <Loading />;
  if (list.length === 0) return <p className="text-sm text-ink-muted">There are no projects yet.</p>;
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };
  return (
    <ul className="max-h-64 divide-y divide-line overflow-auto rounded-md border border-line">
      {list.map((p) => (
        <li key={p.id}>
          <label htmlFor={`${idPrefix}-${p.id}`} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-canvas">
            <input id={`${idPrefix}-${p.id}`} type="checkbox" className="h-4 w-4 accent-cobalt-600" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            <span className="w-6 tabular-nums text-ink-faint">{p.number}</span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function AssignProjectsModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(() => new Set(member.projectIds));
  const save = useMutation({
    mutationFn: () => api.put<Member>(`/orgs/${org.id}/members/${member.userId}/projects`, { projectIds: [...selected] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.members(org.id) });
      toast.info('Projects updated');
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Projects for ${member.name || member.email}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save projects</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">They'll only see the projects ticked here.</p>
      <ProjectPicker idPrefix="assign" selected={selected} onChange={setSelected} />
      <ErrorNote error={save.error} className="mt-3" />
    </Modal>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<Set<Role>>(() => new Set(['tester']));
  const [projectIds, setProjectIds] = useState<Set<string>>(() => new Set());
  const [sent, setSent] = useState<Invitation | null>(null);
  const seesAll = can([...roles], 'seeAllProjects');

  const invite = useMutation({
    mutationFn: () =>
      api.post<Invitation>(`/orgs/${org.id}/members/invite`, {
        email,
        roles: normaliseRoles([...roles]),
        projectIds: seesAll ? [] : [...projectIds],
      }),
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
  const toggleRole = (r: Role) =>
    setRoles((prev) => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });

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
        <form id="invite-form" className="space-y-5" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
          <div>
            <label className="label" htmlFor="invite-email">Email</label>
            <input id="invite-email" type="email" required autoFocus className="field" value={email} placeholder="name@company.com" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <fieldset>
            <legend className="label">Roles</legend>
            <div className="space-y-2">
              {ASSIGNABLE_ROLES.map((r) => (
                <label key={r} htmlFor={`invite-role-${r}`} className="flex cursor-pointer items-start gap-3 text-sm">
                  <input id={`invite-role-${r}`} type="checkbox" className="mt-0.5 h-4 w-4 accent-cobalt-600" checked={roles.has(r)} onChange={() => toggleRole(r)} />
                  <span>
                    <span className="font-medium">{ROLE_LABELS[r]}</span>
                    <span className="block text-ink-muted">{ROLE_DESCRIPTIONS[r]}</span>
                  </span>
                </label>
              ))}
            </div>
            {roles.size === 0 && <p className="mt-2 text-xs text-ink-muted">No roles ticked: {VIEWER_DESCRIPTION.toLowerCase()}.</p>}
          </fieldset>
          <fieldset>
            <legend className="label">Projects</legend>
            {seesAll ? (
              <p className="text-sm text-ink-muted">Admins see every project.</p>
            ) : (
              <ProjectPicker idPrefix="invite" selected={projectIds} onChange={setProjectIds} />
            )}
          </fieldset>
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
        You'll lose access to its projects and results.{org.roles.includes('owner') && ' Make someone else an owner first.'}
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
