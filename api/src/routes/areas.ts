import { Router } from 'express';
import { z } from 'zod';
import { createAreaSchema, updateAreaSchema, type Area } from '@testscript/shared';
import { one, query, tx } from '../db';
import { audit, changed, currentUser, requireOrg } from '../authz';
import { conflict, notFound, parse } from '../errors';
import { iso } from '../pagination';

/**
 * The organisation's list of test areas (Payroll, Onboarding…), maintained by
 * admins. Managers pick from it when they add a test area to a project.
 */
export const areasRouter = Router();

const AREA_SQL = `
  SELECT a.*,
         (SELECT count(*) FROM suites s JOIN projects p ON p.id = s.project_id
           WHERE s.area_id = a.id AND s.deleted_at IS NULL AND p.deleted_at IS NULL) AS usage_count
    FROM areas a`;

function mapArea(r: any): Area {
  return {
    id: r.id,
    name: r.name,
    archived: Boolean(r.archived_at),
    usageCount: Number(r.usage_count ?? 0),
    createdAt: iso(r.created_at)!,
  };
}

const listQuery = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

areasRouter.get('/orgs/:orgId/areas', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'read');
  const { includeArchived } = parse(listQuery, req.query);
  const rows = await query(
    `${AREA_SQL} WHERE a.org_id = $1 AND ($2 OR a.archived_at IS NULL) ORDER BY lower(a.name)`,
    [org.id, includeArchived],
  );
  res.json({ data: rows.map(mapArea), nextCursor: null });
});

areasRouter.post('/orgs/:orgId/areas', async (req, res) => {
  const user = currentUser(req);
  const org = await requireOrg(req, req.params.orgId, 'editOrg');
  const { name } = parse(createAreaSchema, req.body);
  const area = await tx(async (db) => {
    const existing = await one('SELECT archived_at FROM areas WHERE org_id = $1 AND lower(name) = lower($2)', [org.id, name], db);
    if (existing) {
      throw conflict(existing.archived_at ? `${name} already exists but is archived. Restore it instead.` : `${name} is already in the list`);
    }
    const row = await one(
      'INSERT INTO areas (org_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [org.id, name, user.id],
      db,
    );
    await audit(req, { orgId: org.id, action: 'area.created', entityType: 'area', entityId: row.id, diff: { name } }, db);
    return one(`${AREA_SQL} WHERE a.id = $1`, [row.id], db);
  });
  res.status(201).json(mapArea(area));
});

areasRouter.patch('/orgs/:orgId/areas/:areaId', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'editOrg');
  const input = parse(updateAreaSchema, req.body);
  const area = await tx(async (db) => {
    const before = await one(
      'SELECT id, name, archived_at IS NOT NULL AS archived FROM areas WHERE id::text = $1 AND org_id = $2 FOR UPDATE',
      [req.params.areaId, org.id],
      db,
    );
    if (!before) throw notFound('Area');
    if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) {
      const clash = await one('SELECT 1 FROM areas WHERE org_id = $1 AND lower(name) = lower($2) AND id <> $3', [org.id, input.name, before.id], db);
      if (clash) throw conflict(`${input.name} is already in the list`);
    }
    await db.query(
      `UPDATE areas SET name = COALESCE($2, name),
              archived_at = CASE WHEN $3::boolean IS NULL THEN archived_at WHEN $3 THEN COALESCE(archived_at, now()) ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [before.id, input.name ?? null, input.archived ?? null],
    );
    // Renaming an area renames every test area that uses it.
    if (input.name && input.name !== before.name) {
      await db.query('UPDATE suites SET name = $2, updated_at = now() WHERE area_id = $1', [before.id, input.name]);
    }
    await audit(req, { orgId: org.id, action: 'area.updated', entityType: 'area', entityId: before.id, diff: changed(before, input) }, db);
    return one(`${AREA_SQL} WHERE a.id = $1`, [before.id], db);
  });
  res.json(mapArea(area));
});
