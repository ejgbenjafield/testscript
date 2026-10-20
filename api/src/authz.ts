import type { Request } from 'express';
import { hasRole, type Role } from '@testscript/shared';
import { Db, isUuid, one, pool } from './db';
import { forbidden, notFound, unauthorized } from './errors';

export interface OrgAccess {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export function currentUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * Resolve an organisation by id or slug and check the caller's role there.
 * Callers who aren't members get 404, so other tenants' ids can't be probed.
 */
export async function requireOrg(req: Request, idOrSlug: string, min: Role, db: Db = pool): Promise<OrgAccess> {
  const user = currentUser(req);
  const byId = isUuid(idOrSlug);
  const row = await one<OrgAccess>(
    `SELECT o.id, o.slug, o.name, m.role
       FROM organisations o
       JOIN org_members m ON m.org_id = o.id AND m.user_id = $2
      WHERE ${byId ? 'o.id = $1' : 'o.slug = $1'}`,
    [byId ? idOrSlug : idOrSlug.toLowerCase(), user.id],
    db,
  );
  if (!row) throw notFound('Organisation');
  if (!hasRole(row.role, min)) throw forbidden();
  req.org = row;
  return row;
}

type Kind = 'project' | 'suite' | 'testCase' | 'step' | 'run' | 'runResult' | 'attachment';

const LOOKUPS: Record<Kind, { label: string; sql: string }> = {
  project: {
    label: 'Project',
    sql: `SELECT p.id, p.org_id FROM projects p WHERE p.id = $1 AND p.deleted_at IS NULL`,
  },
  suite: {
    label: 'Suite',
    sql: `SELECT s.id, s.org_id, s.project_id FROM suites s
            JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
           WHERE s.id = $1 AND s.deleted_at IS NULL`,
  },
  testCase: {
    label: 'Test case',
    sql: `SELECT t.id, t.org_id, t.suite_id FROM test_cases t
            JOIN suites s ON s.id = t.suite_id AND s.deleted_at IS NULL
            JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
           WHERE t.id = $1 AND t.deleted_at IS NULL`,
  },
  step: {
    label: 'Step',
    sql: `SELECT st.id, st.org_id, st.test_case_id FROM steps st
            JOIN test_cases t ON t.id = st.test_case_id AND t.deleted_at IS NULL
            JOIN suites s ON s.id = t.suite_id AND s.deleted_at IS NULL
            JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
           WHERE st.id = $1 AND st.deleted_at IS NULL`,
  },
  // Run history stays readable even after its suite is deleted.
  run: {
    label: 'Run',
    sql: `SELECT r.id, r.org_id, r.suite_id, r.status FROM runs r WHERE r.id = $1`,
  },
  runResult: {
    label: 'Result',
    sql: `SELECT rr.id, rr.org_id, rr.run_id, r.status AS run_status
            FROM run_results rr JOIN runs r ON r.id = rr.run_id
           WHERE rr.id = $1`,
  },
  attachment: {
    label: 'Attachment',
    sql: `SELECT a.id, a.org_id, a.entity_type, a.entity_id, a.uploader_id
            FROM attachments a WHERE a.id = $1 AND a.deleted_at IS NULL`,
  },
};

/** Load a resource, find the organisation that owns it and check the caller's role there. */
export async function requireResource<T extends { id: string; org_id: string } = any>(
  req: Request,
  kind: Kind,
  id: string,
  min: Role,
  db: Db = pool,
): Promise<T & { role: Role }> {
  const user = currentUser(req);
  const lookup = LOOKUPS[kind];
  if (!isUuid(id)) throw notFound(lookup.label);
  const row = await one<T>(lookup.sql, [id], db);
  if (!row) throw notFound(lookup.label);
  const member = await one<{ role: Role; slug: string; name: string }>(
    `SELECT m.role, o.slug, o.name FROM org_members m JOIN organisations o ON o.id = m.org_id
      WHERE m.org_id = $1 AND m.user_id = $2`,
    [row.org_id, user.id],
    db,
  );
  if (!member) throw notFound(lookup.label);
  if (!hasRole(member.role, min)) throw forbidden();
  req.org = { id: row.org_id, slug: member.slug, name: member.name, role: member.role };
  return { ...row, role: member.role };
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
