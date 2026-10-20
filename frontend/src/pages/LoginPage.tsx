import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/api';
import { ErrorNote } from '../components/ui';

export function LoginPage() {
  const { status, mode, devLoginEnabled, login } = useAuth();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signedIn') return <Navigate to={returnTo} replace />;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex items-center gap-2 text-lg font-bold">
            <img src="/favicon.svg" alt="" className="h-7 w-7" /> TestScript
          </div>
          <h1 className="mt-10 text-2xl font-semibold">Sign in</h1>

          {mode === 'auth0' ? (
            <>
              <p className="mt-2 text-ink-muted">Use your email and password, or your Google account.</p>
              <button
                className="btn-primary mt-6 w-full py-2.5"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await login({ returnTo });
                }}
              >
                Continue to sign in
              </button>
            </>
          ) : devLoginEnabled ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await login({ email, name: name || undefined, returnTo });
                } catch (err) {
                  setError(errorMessage(err));
                  setBusy(false);
                }
              }}
            >
              <p className="rounded-md bg-skip-soft px-3 py-2 text-sm text-ink-soft">
                Development sign-in: any email works and no password is needed. Switch to Auth0 before real people use this.
              </p>
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input id="email" type="email" required autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="name">Your name (optional)</label>
                <input id="name" autoComplete="name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {error && <ErrorNote error={error} />}
              <button className="btn-primary w-full py-2.5" disabled={busy}>
                Sign in
              </button>
            </form>
          ) : (
            <p className="mt-4 text-ink-muted">
              Sign-in isn't set up for this published app yet. Add the Auth0 settings to the app's secrets (see the README), or set{' '}
              <code className="rounded bg-canvas px-1">ALLOW_DEV_LOGIN=true</code> for a private preview.
            </p>
          )}
        </div>
      </section>
      <LoginArt />
    </main>
  );
}

/** A finished run, drawn as rows of step results: the thing this product is about. */
function LoginArt() {
  const rows = [
    'ppppppp', 'pppppfp', 'pppppp', 'ppsppppp', 'pppp', 'ppppfpp', 'ppppppp', 'pppssp', 'ppppppp', 'ppfppp',
  ];
  const colour = { p: 'bg-pass', f: 'bg-fail', s: 'bg-skip' } as const;
  return (
    <section aria-hidden className="hidden flex-col justify-center gap-10 bg-cobalt-700 px-14 text-white lg:flex">
      <div className="space-y-2.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-28 truncate text-sm text-cobalt-100/70">Test case {i + 1}</span>
            <div className="flex gap-1">
              {row.split('').map((c, j) => (
                <span key={j} className={`h-4 w-7 rounded-sm ${colour[c as keyof typeof colour]}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="max-w-md text-2xl font-semibold leading-snug">
        Write your manual tests once. Run them every release, and see what changed.
      </p>
    </section>
  );
}

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return '/';
  return value;
}
