import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type Org, type SearchHit } from '@testscript/shared';
import { api, ApiError, qs } from '../lib/api';
import { keys, OrgContext, useMe, useOrg } from '../lib/queries';
import { useAuth } from '../auth/AuthProvider';
import { rememberOrg } from '../lib/prefs';
import { Avatar, FullPageMessage, Loading } from './ui';

export function OrgLayout() {
  const { org: slug = '' } = useParams();
  const orgQuery = useQuery({ queryKey: keys.org(slug), queryFn: () => api.get<Org>(`/orgs/${slug}`), retry: false });

  if (orgQuery.isPending) return <Loading />;
  if (orgQuery.isError) {
    const missing = orgQuery.error instanceof ApiError && orgQuery.error.status === 404;
    return (
      <FullPageMessage title={missing ? 'Organisation not found' : 'Something went wrong'}>
        {missing ? "It doesn't exist, or you're not a member. " : `${orgQuery.error.message} `}
        <Link className="link" to="/">
          Go to your organisations
        </Link>
      </FullPageMessage>
    );
  }
  return (
    <OrgContext.Provider value={orgQuery.data}>
      <Shell />
    </OrgContext.Provider>
  );
}

function Shell() {
  const org = useOrg();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => rememberOrg(org.slug), [org.slug]);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3 lg:hidden">
        <Wordmark />
        <button className="btn-ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          Menu
        </button>
      </header>
      <aside
        className={`${menuOpen ? 'block' : 'hidden'} border-b border-line bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r`}
      >
        <div className="hidden px-5 pb-2 pt-5 lg:block">
          <Wordmark />
        </div>
        <OrgSwitcher />
        <nav className="flex flex-col gap-0.5 px-3 py-2" onClick={() => setMenuOpen(false)}>
          <SideLink to={`/${org.slug}/dashboard`}>Dashboard</SideLink>
          <SideLink to={`/${org.slug}/settings`}>Members and settings</SideLink>
        </nav>
        <div className="mt-auto">
          <UserMenu />
        </div>
      </aside>
      <div className="min-w-0">
        <div className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:px-8">
          <SearchBox />
        </div>
        <main id="main" className="px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-ink">
      <img src="/favicon.svg" alt="" className="h-6 w-6" />
      TestScript
    </Link>
  );
}

function SideLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-cobalt-50 font-semibold text-cobalt-700' : 'text-ink-soft hover:bg-canvas'}`
      }
    >
      {children}
    </NavLink>
  );
}

function OrgSwitcher() {
  const org = useOrg();
  const me = useMe();
  const navigate = useNavigate();
  const others = me.data?.orgs ?? [];
  return (
    <div className="px-3 py-2">
      <label htmlFor="org-switch" className="sr-only">
        Organisation
      </label>
      <select
        id="org-switch"
        className="field font-medium"
        value={org.slug}
        onChange={(e) => (e.target.value === '__new' ? navigate('/new') : navigate(`/${e.target.value}/dashboard`))}
      >
        {!others.some((o) => o.slug === org.slug) && <option value={org.slug}>{org.name}</option>}
        {others.map((o) => (
          <option key={o.id} value={o.slug}>
            {o.name}
          </option>
        ))}
        <option value="__new">New organisation…</option>
      </select>
      <p className="mt-1 px-1 text-xs text-ink-muted">You're {ROLE_LABELS[org.role].toLowerCase()} here</p>
    </div>
  );
}

function UserMenu() {
  const me = useMe();
  const { logout, mode } = useAuth();
  const user = me.data?.user;
  return (
    <div className="flex items-center gap-2 border-t border-line px-4 py-3">
      <Avatar name={user?.name} email={user?.email} url={user?.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user?.name || user?.email}</p>
        {mode === 'dev' && <p className="text-xs text-ink-faint">Dev login</p>}
      </div>
      <button className="btn-ghost btn-sm" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}

function SearchBox() {
  const org = useOrg();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const results = useQuery({
    queryKey: keys.search(org.id, q),
    queryFn: () => api.get<{ data: SearchHit[] }>(`/orgs/${org.id}/search${qs({ q })}`),
    enabled: q.length >= 2,
    placeholderData: (prev) => prev,
  });
  const hits = q.length >= 2 ? (results.data?.data ?? []) : [];

  return (
    <div ref={boxRef} className="relative max-w-xl">
      <label htmlFor="search" className="sr-only">
        Search test cases
      </label>
      <input
        id="search"
        type="search"
        className="field"
        placeholder="Search test cases and steps"
        value={text}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      {open && q.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-auto rounded-lg border border-line bg-white shadow-lg">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-muted">{results.isFetching ? 'Searching…' : `Nothing matches "${q}"`}</p>
          ) : (
            <ul>
              {hits.map((h) => (
                <li key={h.testCaseId}>
                  <button
                    className="block w-full px-4 py-2.5 text-left hover:bg-canvas"
                    onClick={() => {
                      setOpen(false);
                      setText('');
                      navigate(`/${org.slug}/suites/${h.suiteId}?case=${h.testCaseId}`);
                    }}
                  >
                    <span className="block text-sm font-medium">{h.testCaseName}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {h.projectName} / {h.suiteName}
                      {h.matchedStep && <>, in step “{h.matchedStep}”</>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
