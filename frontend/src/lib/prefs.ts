const LAST_ORG_KEY = 'testscript.lastOrg';

export function rememberOrg(slug: string) {
  try {
    localStorage.setItem(LAST_ORG_KEY, slug);
  } catch {
    /* storage unavailable */
  }
}

export function lastOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}
