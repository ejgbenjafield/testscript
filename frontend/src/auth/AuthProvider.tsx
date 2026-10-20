import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthConfig } from '@testscript/shared';
import { api, configureApi } from '../lib/api';
import { FullPageMessage, Spinner } from '../components/ui';

interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  mode: 'dev' | 'auth0';
  devLoginEnabled: boolean;
  /** Dev mode takes an email; Auth0 mode redirects to the login page. */
  login: (opts?: { email?: string; name?: string; returnTo?: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

type ConfigResponse = AuthConfig & { devLoginEnabled: boolean };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/v1/auth/config')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
      .then(setConfig)
      .catch(() => setError("Can't reach the TestScript server. Check that it's running, then reload."));
  }, []);

  if (error) return <FullPageMessage title="Server unavailable">{error}</FullPageMessage>;
  if (!config) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }
  if (config.mode === 'auth0' && config.auth0) {
    return <Auth0Mode config={config}>{children}</Auth0Mode>;
  }
  return <DevMode config={config}>{children}</DevMode>;
}

// Dev login -------------------------------------------------------------------------------

const DEV_TOKEN_KEY = 'testscript.devToken';

function readDevToken() {
  try {
    return localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

function DevMode({ config, children }: { config: ConfigResponse; children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readDevToken);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const value = useMemo<AuthContextValue>(() => {
    const logout = () => {
      try {
        localStorage.removeItem(DEV_TOKEN_KEY);
      } catch {
        /* storage unavailable */
      }
      setToken(null);
      queryClient.clear();
    };
    configureApi({ getToken: async () => token, onUnauthorized: () => token && logout() });
    return {
      status: token ? 'signedIn' : 'signedOut',
      mode: 'dev',
      devLoginEnabled: config.devLoginEnabled,
      logout,
      login: async (opts) => {
        if (!opts?.email) throw new Error('Enter an email address');
        const res = await api.post<{ accessToken: string }>('/auth/dev-login', { email: opts.email, name: opts.name });
        try {
          localStorage.setItem(DEV_TOKEN_KEY, res.accessToken);
        } catch {
          /* storage unavailable: session lasts until reload */
        }
        queryClient.clear();
        setToken(res.accessToken);
        navigate(opts.returnTo || '/', { replace: true });
      },
    };
  }, [token, config.devLoginEnabled, queryClient, navigate]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Auth0 -------------------------------------------------------------------------------------

function Auth0Mode({ config, children }: { config: ConfigResponse; children: ReactNode }) {
  const navigate = useNavigate();
  const { domain, clientId, audience } = config.auth0!;
  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{ redirect_uri: `${window.location.origin}/callback`, audience }}
      // Tokens stay in memory; rotating refresh tokens renew them silently.
      cacheLocation="memory"
      useRefreshTokens
      useRefreshTokensFallback
      onRedirectCallback={(appState) => navigate(appState?.returnTo || '/', { replace: true })}
    >
      <Auth0Bridge>{children}</Auth0Bridge>
    </Auth0Provider>
  );
}

function Auth0Bridge({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, getAccessTokenSilently, loginWithRedirect, logout, error } = useAuth0();
  const queryClient = useQueryClient();

  const value = useMemo<AuthContextValue>(() => {
    const doLogout = () => {
      queryClient.clear();
      logout({ logoutParams: { returnTo: window.location.origin } });
    };
    configureApi({
      getToken: async () => {
        if (!isAuthenticated) return null;
        try {
          return (await getAccessTokenSilently()) ?? null;
        } catch {
          return null;
        }
      },
      onUnauthorized: () => undefined,
    });
    return {
      status: isLoading ? 'loading' : isAuthenticated ? 'signedIn' : 'signedOut',
      mode: 'auth0',
      devLoginEnabled: false,
      logout: doLogout,
      login: async (opts) => {
        await loginWithRedirect({ appState: { returnTo: opts?.returnTo || '/' } });
      },
    };
  }, [isLoading, isAuthenticated, getAccessTokenSilently, loginWithRedirect, logout, queryClient]);

  if (error) {
    return (
      <FullPageMessage title="Sign-in failed">
        {error.message}{' '}
        <a className="link" href="/login">
          Try again
        </a>
      </FullPageMessage>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
