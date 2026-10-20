import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { can, type Area, type Me, type Org, type Page, type Permission } from '@testscript/shared';
import { api } from './api';

export const keys = {
  me: ['me'] as const,
  org: (slug: string) => ['org', slug] as const,
  dashboard: (orgId: string) => ['dashboard', orgId] as const,
  projects: (orgId: string) => ['projects', orgId] as const,
  project: (id: string) => ['project', id] as const,
  suites: (projectId: string) => ['suites', projectId] as const,
  suite: (id: string) => ['suite', id] as const,
  testCases: (suiteId: string) => ['testCases', suiteId] as const,
  runs: (suiteId: string) => ['runs', suiteId] as const,
  run: (id: string) => ['run', id] as const,
  members: (orgId: string) => ['members', orgId] as const,
  areas: (orgId: string) => ['areas', orgId] as const,
  invitations: (orgId: string) => ['invitations', orgId] as const,
  attachments: (type: string, id: string) => ['attachments', type, id] as const,
  search: (orgId: string, q: string) => ['search', orgId, q] as const,
};

export function useMe(enabled = true) {
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<Me>('/me'), enabled });
}

export const OrgContext = createContext<Org | null>(null);

export function useOrg(): Org {
  const org = useContext(OrgContext);
  if (!org) throw new Error('useOrg must be used inside an organisation route');
  return org;
}

/** Whether the current member's role allows an action. The API checks too. */
export function useCan(permission: Permission) {
  return can(useOrg().role, permission);
}

/** The organisation's areas that can be picked for a test area (archived ones left out). */
export function useAreas(enabled = true) {
  const org = useOrg();
  return useQuery({
    queryKey: keys.areas(org.id),
    queryFn: () => api.get<Page<Area>>(`/orgs/${org.id}/areas`),
    enabled,
  });
}
