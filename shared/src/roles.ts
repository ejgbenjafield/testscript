/**
 * Roles combine: a member can be, say, both a Preparer and a Tester. Someone
 * with no roles is a Viewer and can only read. Owner and Admin can do
 * everything, and see every project; everyone else sees only the projects
 * they've been assigned to.
 */
export const ROLES = ['owner', 'admin', 'preparer', 'tester'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an admin can tick for people. Only owners can grant Owner. */
export const ASSIGNABLE_ROLES = ['admin', 'preparer', 'tester'] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const PERMISSIONS = {
  read: [],
  runTests: ['tester', 'preparer'],
  recordResults: ['tester', 'preparer'],
  uploadResultFiles: ['tester', 'preparer'],
  /** Add and edit test areas, test cases and steps. */
  editContent: ['preparer'],
  /** Create, edit and delete projects, and choose who's assigned to them. */
  manageProjects: ['admin'],
  /** See every project, not just assigned ones. */
  seeAllProjects: ['admin'],
  manageMembers: ['admin'],
  editOrg: ['admin'],
  transferOwnership: [],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Whether someone with these roles may do something. Owners can do everything. */
export function can(roles: readonly Role[] | null | undefined, permission: Permission): boolean {
  if (!roles) return false;
  if (roles.includes('owner')) return true;
  if (roles.includes('admin') && permission !== 'transferOwnership') return true;
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return permission === 'read' || roles.some((r) => allowed.includes(r));
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  preparer: 'Preparer',
  tester: 'Tester',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything an admin can do, plus managing other owners',
  admin: 'Create projects, assign people, manage members and settings, and see every project',
  preparer: 'Add and edit test areas, test cases and steps, and run tests',
  tester: 'Run tests and record results, notes and screenshots',
};

export const VIEWER_DESCRIPTION = 'No roles ticked: can see their assigned projects but not change anything';

/** A short description of someone's roles, e.g. "Preparer, Tester" or "Viewer". */
export function describeRoles(roles: readonly Role[]): string {
  if (roles.length === 0) return 'Viewer';
  return ROLES.filter((r) => roles.includes(r)).map((r) => ROLE_LABELS[r]).join(', ');
}

/** Sort and de-duplicate a list of roles into the standard order. */
export function normaliseRoles(roles: readonly Role[]): Role[] {
  return ROLES.filter((r) => roles.includes(r));
}
