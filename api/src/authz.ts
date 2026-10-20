import type { Request } from 'express';
import { can, type Permission, type Role } from '@testscript/shared';
import { Db, isUuid, one, pool } from './db';
import { forbidden, notFound, unauthorized } from './errors';

export interface OrgAccess {
  id: string;
  slug: string;
  name: string;
  roles: Role[];
}

export function currentUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * Resolve an organisation by id or slug and check the caller's role there.
 * Callers who aren't members get 404, so other tenants' ids can't be probed.
 */
export async function requireOrg(req: Request, idOrSlug: string, need: Permission, db: Db = pool): Promise<OrgAccess> {
  const user = currentUser(req);
  const byId = isUuid(idOrSlug);
  const row = await one<OrgAccess>(
    `SELECT o.id, o.slug, o.name, m.roles
       FROM organisations o
       JOIN org_members m ON m.org_id = o.id AND m.user_id = $2
      WHERE ${byId ? 'o.id = $1' : 'o.slug = $1'}`,
    [byId ? idOrSlug : idOrSlug.toLowerCase(), user.id],
    db,
  );
  if (!row) throw notFound('Organisation');
  if (!can(row.roles, need)) throw forbidden();
  req.org = row;
  return row;
}

type Kind = 'project' | 'suite' | 'testCase' | 'step' | 'run' | 'runResult' | 'attachment';

const LOOKUPS: Record<Kind, { label: string; sql: string }> = {
  project: {
    label: 'Project',
    sql: `SELECT p.id, p.org_id, p.id AS project_id FROM projects p WHERE p.id = $1 AND p.deleted_at IS NULL`,
  },
  suite: {
    label: 'Suite',
    sql: `SELECT s.id, s.org_id, s.project_id FROM suites s
            JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
           WHERE s.id = $1 AND s.deleted_at IS NULL`,
  },
  testCase: {
    label: 'Test case',
    sql: `SELECT t.id, t.org_id, t.suite_id, s.project_id FROM test_cases t
            JOIN suites s ON s.id = t.suite_id AND s.deleted_at IS NULL
            JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
           WHERE t.id = $1 AND t.deleted_at IS NULL`,
  },
  step: {
    label: 'Step',
    sql: `SELECT st.id, st.org_id, st.test_case_id, s.project_id FROM steps st
            JOIN test_cases t ON t.id = st.test_case_id AND t.deleted_at IS NULL
            JOIN suites s ON s.id = t.suite_id AND s.deleted_at IS NULL
            JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
           WHERE st.id = $1 AND st.deleted_at IS NULL`,
  },
  // Run history stays readable even after its suite is deleted.
  run: {
    label: 'Run',
    sql: `SELECT r.id, r.org_id, r.suite_id, r.status, s.project_id
            FROM runs r JOIN suites s ON s.id = r.suite_id WHERE r.id = $1`,
  },
  runResult: {
    label: 'Result',
    sql: `SELECT rr.id, rr.org_id, rr.run_id, r.status AS run_status, s.project_id
            FROM run_results rr JOIN runs r ON r.id = rr.run_id JOIN suites s ON s.id = r.suite_id
           WHERE rr.id = $1`,
  },
  attachment: {
    label: 'Attachment',
    sql: `SELECT a.id, a.org_id, a.entity_type, a.entity_id, a.uploader_id,
                 CASE a.entity_type
                   WHEN 'step' THEN (SELECT s.project_id FROM steps st JOIN test_cases t ON t.id = st.test_case_id
                                       JOIN suites s ON s.id = t.suite_id WHERE st.id = a.entity_id)
                   ELSE (SELECT s.project_id FROM run_results rr JOIN runs r ON r.id = rr.run_id
                           JOIN suites s ON s.id = r.suite_id WHERE rr.id = a.entity_id)
                 END AS project_id
            FROM attachments a WHERE a.id = $1 AND a.deleted_at IS NULL`,
  },
};

/**
 * Load a resource, find the organisation and project that own it, and check
 * the caller may see that project and has the permission needed.
 */
export async function requireResource<T extends { id: string; org_id: string; project_id: string } = any>(
  req: Request,
  kind: Kind,
  id: string,
  need: Permission,
  db: Db = pool,
): Promise<T & { roles: Role[] }> {
  const user = currentUser(req);
  const lookup = LOOKUPS[kind];
  if (!isUuid(id)) throw notFound(lookup.label);
  const row = await one<T>(lookup.sql, [id], db);
  if (!row) throw notFound(lookup.label);
  const member = await one<{ roles: Role[]; slug: string; name: string; assigned: boolean }>(
    `SELECT m.roles, o.slug, o.name,
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $3 AND pm.user_id = m.user_id) AS assigned
       FROM org_members m JOIN organisations o ON o.id = m.org_id
      WHERE m.org_id = $1 AND m.user_id = $2`,
    [row.org_id, user.id, row.project_id],
    db,
  );
  // Not a member, or a project they aren't assigned to: as far as they know, it doesn't exist.
  if (!member) throw notFound(lookup.label);
  if (!member.assigned && !can(member.roles, 'seeAllProjects')) throw notFound(lookup.label);
  if (!can(member.roles, need)) throw forbidden();
  req.org = { id: row.org_id, slug: member.slug, name: member.name, roles: member.roles };
  return { ...row, roles: member.roles };
}

/**
 * SQL that limits a query to projects the caller can see. `projectCol` is
 * the project id column; the two parameters are filled from `visibleArgs`.
 */
export function visibleProjects(projectCol: string, seeAllParam: number, userParam: number) {
  return `($${seeAllParam}::boolean OR EXISTS (SELECT 1 FROM project_members pm
            WHERE pm.project_id = ${projectCol} AND pm.user_id = $${userParam}))`;
}
export function visibleArgs(req: Request, org: OrgAccess): [boolean, string] {
  return [can(org.roles, 'seeAllProjects'), currentUser(req).id];
}

export async function audit(
  req: Request,
  entry: { orgId: string; action: string; entityType: string; entityId?: string | null; diff?: unknown },
  db: Db = pool,
) {
  await db.query(
    `INSERT INTO audit_log (org_id, user_id, action, entity_type, entity_id, diff, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.orgId,
      req.user?.id ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.diff === undefined ? null : JSON.stringify(entry.diff),
      clientIp(req),
      String(req.headers['user-agent'] || '').slice(0, 500) || null,
    ],
  );
}

function clientIp(req: Request): string | null {
  const ip = (req.ip || '').replace(/^::ffff:/, '');
  return /^[0-9a-f:.]+$/i.test(ip) ? ip : null;
}

/** Fields that changed between two plain objects, for audit diffs. */
export function changed(before: Record<string, any>, after: Record<string, any>) {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] !== undefined && before[key] !== after[key]) diff[key] = { from: before[key], to: after[key] };
  }
  return diff;
}
