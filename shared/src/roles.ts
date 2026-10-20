export const ROLES = ['viewer', 'tester', 'manager', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, tester: 1, manager: 2, admin: 3, owner: 4 };

/** True when `role` is at least as powerful as `min`. */
export function hasRole(role: Role | null | undefined, min: Role): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** What each role may do, used by the API and to show or hide UI controls. */
export const PERMISSIONS = {
  read: 'viewer',
  runTests: 'tester',
  recordResults: 'tester',
  uploadResultFiles: 'tester',
  editContent: 'manager',
  manageMembers: 'admin',
  editOrg: 'admin',
  transferOwnership: 'owner',
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return hasRole(role, PERMISSIONS[permission]);
}

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'Viewer',
  tester: 'Tester',
  manager: 'Manager',
  admin: 'Admin',
  owner: 'Owner',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: 'Read-only access to scripts and results',
  tester: 'Run tests, record results and add attachments',
  manager: 'Create, edit and delete projects, suites and test cases',
  admin: 'Manage members and organisation settings',
  owner: 'Full access, including ownership changes',
};
