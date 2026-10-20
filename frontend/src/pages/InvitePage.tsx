import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type InvitationPreview } from '@testscript/shared';
import { api } from '../lib/api';
import { keys, useMe } from '../lib/queries';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNote, FullPageMessage, Loading } from '../components/ui';

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const { logout } = useAuth();
  const invite = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationPreview>(`/invitations/${token}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api.post<{ orgSlug: string }>(`/invitations/${token}/accept`),
    onSuccess: async ({ orgSlug }) => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      navigate(`/${orgSlug}/dashboard`, { replace: true });
    },
  });

  if (invite.isPending || me.isPending) return <Loading />;
  if (invite.isError) {
    return <FullPageMessage title="Invitation not found">This link isn't valid any more. Ask whoever invited you to send a new one.</FullPageMessage>;
  }
  const inv = invite.data;
  const email = me.data?.user.email ?? '';
  const wrongAccount = email.toLowerCase() !== inv.email.toLowerCase();

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-semibold">Join {inv.orgName}</h1>
      <p className="mt-2 text-ink-muted">
        {inv.invitedBy ?? 'Someone'} invited {inv.email} to join as {ROLE_LABELS[inv.role].toLowerCase()}: {ROLE_DESCRIPTIONS[inv.role].toLowerCase()}.
      </p>

      {inv.accepted ? (
        <p className="mt-6">This invitation has already been used.</p>
      ) : inv.expired ? (
        <p className="mt-6">This invitation has expired. Ask {inv.invitedBy ?? 'an admin'} for a new one.</p>
      ) : wrongAccount ? (
        <div className="mt-6 space-y-3">
          <p>
            You're signed in as <b>{email}</b>. Sign in as <b>{inv.email}</b> to accept.
          </p>
          <button className="btn-secondary" onClick={logout}>Sign out</button>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          <ErrorNote error={accept.error} />
          <button className="btn-primary" disabled={accept.isPending} onClick={() => accept.mutate()}>
            Join {inv.orgName}
          </button>
        </div>
      )}
    </main>
  );
}
