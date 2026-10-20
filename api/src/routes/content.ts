import { Router } from 'express';
import { z } from 'zod';
import {
  createProjectSchema,
  createStepSchema,
  createSuiteSchema,
  createTestCaseSchema,
  paginationSchema,
  reorderSchema,
  updateProjectSchema,
  updateStepSchema,
  updateSuiteSchema,
  updateTestCaseSchema,
  type Project,
  type Step,
  type Suite,
  type TestCase,
} from '@testscript/shared';
import { Db, one, query, tx } from '../db';
import { audit, changed, currentUser, requireOrg, requireResource } from '../authz';
import { badRequest, parse } from '../errors';
import { iso, toPage } from '../pagination';
import { mapRunSummary, RUN_SUMMARY_SQL } from '../runSummary';

export const contentRouter = Router();

// Mappers -------------------------------------------------------------------------

function mapProject(r: any): Project {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    description: r.description,
    suiteCount: Number(r.suite_count ?? 0),
    testCaseCount: Number(r.test_case_count ?? 0),
    lastRunAt: iso(r.last_run_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

function mapSuite(r: any): Suite {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    name: r.name,
    description: r.description,
    testCaseCount: Number(r.test_case_count ?? 0),
    lastRun: r.last_run ? mapRunSummary(r.last_run) : null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

function mapStep(r: any): Step {
  return {
    id: r.id,
    testCaseId: r.test_case_id,
    position: r.position,
    action: r.action,
    expectedResult: r.expected_result,
    attachmentCount: r.attachment_count === undefined ? undefined : Number(r.attachment_count),
  };
}

function mapTestCase(r: any, steps?: Step[]): TestCase {
  return {
    id: r.id,
    suiteId: r.suite_id,
    name: r.name,
    description: r.description,
    position: r.position,
    stepCount: steps ? steps.length : Number(r.step_count ?? 0),
    steps,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

// Queries ---------------------------------------------------------------------------

const PROJECT_SQL = `
  SELECT p.*,
         (SELECT count(*) FROM suites s WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS suite_count,
         (SELECT count(*) FROM test_cases t JOIN suites s ON s.id = t.suite_id
           WHERE s.project_id = p.id AND s.deleted_at IS NULL AND t.deleted_at IS NULL) AS test_case_count,
         (SELECT max(r.started_at) FROM runs r JOIN suites s ON s.id = r.suite_id
           WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS last_run_at
    FROM projects p`;

const SUITE_SQL = `
  SELECT s.*, p.name AS project_name,
         (SELECT count(*) FROM test_cases t WHERE t.suite_id = s.id AND t.deleted_at IS NULL) AS test_case_count,
         (SELECT row_to_json(lr) FROM (${RUN_SUMMARY_SQL} WHERE r.suite_id = s.id ORDER BY r.started_at DESC LIMIT 1) lr) AS last_run
    FROM suites s JOIN projects p ON p.id = s.project_id`;

const STEP_SQL = `
  SELECT st.*,
         (SELECT count(*) FROM attachments a
           WHERE a.entity_type = 'step' AND a.entity_id = st.id AND a.deleted_at IS NULL) AS attachment_count
    FROM steps st`;

async function getProject(id: string, db?: Db) {
  return mapProject(await one(`${PROJECT_SQL} WHERE p.id = $1`, [id], db));
}
async function getSuite(id: string, db?: Db) {
  return mapSuite(await one(`${SUITE_SQL} WHERE s.id = $1`, [id], db));
}
async function stepsFor(testCaseIds: string[], db?: Db): Promise<Map<string, Step[]>> {
  const byCase = new Map<string, Step[]>(testCaseIds.map((id) => [id, []]));
  if (testCaseIds.length === 0) return byCase;
  const rows = await query(
    `${STEP_SQL} WHERE st.test_case_id = ANY($1::uuid[]) AND st.deleted_at IS NULL ORDER BY st.position, st.created_at`,
    [testCaseIds],
    db,
  );
  for (const r of rows) byCase.get(r.test_case_id)!.push(mapStep(r));
  return byCase;
}
async function getTestCase(id: string, db?: Db) {
  const row = await one('SELECT * FROM test_cases WHERE id = $1', [id], db);
  const steps = await stepsFor([id], db);
  return mapTestCase(row, steps.get(id));
}

/** Set positions 0..n-1 in the given order. */
async function applyOrder(db: Db, table: 'test_cases' | 'steps', ids: string[]) {
  await db.query(
    `UPDATE ${table} t SET position = o.ord - 1, updated_at = now()
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord) WHERE t.id = o.id`,
    [ids],
  );
}

// Projects ------------------------------------------------------------------------

contentRouter.get('/orgs/:orgId/projects', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'viewer');
  const { after, limit } = parse(paginationSchema, req.query);
  const rows = await query(
    `${PROJECT_SQL}
      WHERE p.org_id = $1 AND p.deleted_at IS NULL
        AND ($2::uuid IS NULL OR (p.created_at, p.id) < (SELECT created_at, id FROM projects WHERE id = $2))
      ORDER BY p.created_at DESC, p.id DESC LIMIT $3`,
    [org.id, after ?? null, limit + 1],
  );
  res.json(toPage(rows, limit, mapProject));
});

contentRouter.post('/orgs/:orgId/projects', async (req, res) => {
  const user = currentUser(req);
  const org = await requireOrg(req, req.params.orgId, 'manager');
  const input = parse(createProjectSchema, req.body);
  const project = await tx(async (db) => {
    const row = await one(
      `INSERT INTO projects (org_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [org.id, input.name, input.description ?? null, user.id],
      db,
    );
    await audit(req, { orgId: org.id, action: 'project.created', entityType: 'project', entityId: row.id, diff: input }, db);
    return getProject(row.id, db);
  });
  res.status(201).json(project);
});

contentRouter.get('/orgs/:orgId/projects/:projectId', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'viewer');
  const p = await requireResource(req, 'project', req.params.projectId, 'viewer');
  if (p.org_id !== org.id) throw badRequest('Project belongs to a different organisation');
  res.json(await getProject(p.id));
});

contentRouter.patch('/orgs/:orgId/projects/:projectId', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'manager');
  const p = await requireResource(req, 'project', req.params.projectId, 'manager');
  if (p.org_id !== org.id) throw badRequest('Project belongs to a different organisation');
  const input = parse(updateProjectSchema, req.body);
  const project = await tx(async (db) => {
    const before = await one('SELECT name, description FROM projects WHERE id = $1 FOR UPDATE', [p.id], db);
    await db.query(
      `UPDATE projects SET name = COALESCE($2, name),
              description = CASE WHEN $4 THEN $3 ELSE description END, updated_at = now() WHERE id = $1`,
      [p.id, input.name ?? null, input.description ?? null, input.description !== undefined],
    );
    await audit(req, { orgId: org.id, action: 'project.updated', entityType: 'project', entityId: p.id, diff: changed(before, input) }, db);
    return getProject(p.id, db);
  });
  res.json(project);
});

contentRouter.delete('/orgs/:orgId/projects/:projectId', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'manager');
  const p = await requireResource(req, 'project', req.params.projectId, 'manager');
  if (p.org_id !== org.id) throw badRequest('Project belongs to a different organisation');
  await tx(async (db) => {
    await db.query('UPDATE projects SET deleted_at = now() WHERE id = $1', [p.id]);
    await audit(req, { orgId: org.id, action: 'project.deleted', entityType: 'project', entityId: p.id }, db);
  });
  res.status(204).end();
});

// Suites ------------------------------------------------------------------------------

contentRouter.get('/projects/:projectId/suites', async (req, res) => {
  const p = await requireResource(req, 'project', req.params.projectId, 'viewer');
  const { after, limit } = parse(paginationSchema, req.query);
  const rows = await query(
    `${SUITE_SQL}
      WHERE s.project_id = $1 AND s.deleted_at IS NULL
        AND ($2::uuid IS NULL OR (s.created_at, s.id) > (SELECT created_at, id FROM suites WHERE id = $2))
      ORDER BY s.created_at, s.id LIMIT $3`,
    [p.id, after ?? null, limit + 1],
  );
  res.json(toPage(rows, limit, mapSuite));
});

contentRouter.post('/projects/:projectId/suites', async (req, res) => {
  const user = currentUser(req);
  const p = await requireResource(req, 'project', req.params.projectId, 'manager');
  const input = parse(createSuiteSchema, req.body);
  const suite = await tx(async (db) => {
    const row = await one(
      `INSERT INTO suites (org_id, project_id, name, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [p.org_id, p.id, input.name, input.description ?? null, user.id],
      db,
    );
    await db.query('UPDATE projects SET updated_at = now() WHERE id = $1', [p.id]);
    await audit(req, { orgId: p.org_id, action: 'suite.created', entityType: 'suite', entityId: row.id, diff: input }, db);
    return getSuite(row.id, db);
  });
  res.status(201).json(suite);
});

contentRouter.get('/suites/:suiteId', async (req, res) => {
  const s = await requireResource(req, 'suite', req.params.suiteId, 'viewer');
  res.json(await getSuite(s.id));
});

contentRouter.patch('/suites/:suiteId', async (req, res) => {
  const s = await requireResource(req, 'suite', req.params.suiteId, 'manager');
  const input = parse(updateSuiteSchema, req.body);
  const suite = await tx(async (db) => {
    const before = await one('SELECT name, description FROM suites WHERE id = $1 FOR UPDATE', [s.id], db);
    await db.query(
      `UPDATE suites SET name = COALESCE($2, name),
              description = CASE WHEN $4 THEN $3 ELSE description END, updated_at = now() WHERE id = $1`,
      [s.id, input.name ?? null, input.description ?? null, input.description !== undefined],
    );
    await audit(req, { orgId: s.org_id, action: 'suite.updated', entityType: 'suite', entityId: s.id, diff: changed(before, input) }, db);
    return getSuite(s.id, db);
  });
  res.json(suite);
});

contentRouter.delete('/suites/:suiteId', async (req, res) => {
  const s = await requireResource(req, 'suite', req.params.suiteId, 'manager');
  await tx(async (db) => {
    await db.query('UPDATE suites SET deleted_at = now() WHERE id = $1', [s.id]);
    await audit(req, { orgId: s.org_id, action: 'suite.deleted', entityType: 'suite', entityId: s.id }, db);
  });
  res.status(204).end();
});

// Test cases --------------------------------------------------------------------------

const listTestCasesQuery = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  includeSteps: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

contentRouter.get('/suites/:suiteId/test-cases', async (req, res) => {
  const s = await requireResource(req, 'suite', req.params.suiteId, 'viewer');
  const { after, limit, includeSteps } = parse(listTestCasesQuery, req.query);
  const rows = await query(
    `SELECT t.*, (SELECT count(*) FROM steps st WHERE st.test_case_id = t.id AND st.deleted_at IS NULL) AS step_count
       FROM test_cases t
      WHERE t.suite_id = $1 AND t.deleted_at IS NULL
        AND ($2::uuid IS NULL OR (t.position, t.id) > (SELECT position, id FROM test_cases WHERE id = $2))
      ORDER BY t.position, t.id LIMIT $3`,
    [s.id, after ?? null, limit + 1],
  );
  const steps = includeSteps ? await stepsFor(rows.slice(0, limit).map((r) => r.id)) : null;
  res.json(toPage(rows, limit, (r) => mapTestCase(r, steps?.get(r.id))));
});

contentRouter.post('/suites/:suiteId/test-cases', async (req, res) => {
  const user = currentUser(req);
  const s = await requireResource(req, 'suite', req.params.suiteId, 'manager');
  const input = parse(createTestCaseSchema, req.body);
  const testCase = await tx(async (db) => {
    await db.query('SELECT 1 FROM suites WHERE id = $1 FOR UPDATE', [s.id]);
    const next = await one(
      'SELECT COALESCE(max(position) + 1, 0) AS pos FROM test_cases WHERE suite_id = $1 AND deleted_at IS NULL',
      [s.id],
      db,
    );
    const row = await one(
      `INSERT INTO test_cases (org_id, suite_id, name, description, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [s.org_id, s.id, input.name, input.description ?? null, next.pos, user.id],
      db,
    );
    for (const [i, step] of (input.steps ?? []).entries()) {
      await db.query(
        `INSERT INTO steps (org_id, test_case_id, position, action, expected_result) VALUES ($1, $2, $3, $4, $5)`,
        [s.org_id, row.id, i, step.action, step.expectedResult ?? null],
      );
    }
    await db.query('UPDATE suites SET updated_at = now() WHERE id = $1', [s.id]);
    await audit(req, { orgId: s.org_id, action: 'test_case.created', entityType: 'test_case', entityId: row.id, diff: { name: input.name, steps: input.steps?.length ?? 0 } }, db);
    return getTestCase(row.id, db);
  });
  res.status(201).json(testCase);
});

contentRouter.post('/suites/:suiteId/test-cases/reorder', async (req, res) => {
  const s = await requireResource(req, 'suite', req.params.suiteId, 'manager');
  const { ids } = parse(reorderSchema, req.body);
  await tx(async (db) => {
    const current = await query(
      'SELECT id FROM test_cases WHERE suite_id = $1 AND deleted_at IS NULL FOR UPDATE',
      [s.id],
      db,
    );
    assertSameSet(current.map((r) => r.id), ids, 'test cases in this suite');
    await applyOrder(db, 'test_cases', ids);
    await audit(req, { orgId: s.org_id, action: 'test_case.reordered', entityType: 'suite', entityId: s.id, diff: { ids } }, db);
  });
  res.json({ ids });
});

contentRouter.get('/test-cases/:testCaseId', async (req, res) => {
  const t = await requireResource(req, 'testCase', req.params.testCaseId, 'viewer');
  res.json(await getTestCase(t.id));
});

contentRouter.patch('/test-cases/:testCaseId', async (req, res) => {
  const t = await requireResource(req, 'testCase', req.params.testCaseId, 'manager');
  const input = parse(updateTestCaseSchema, req.body);
  const testCase = await tx(async (db) => {
    const before = await one('SELECT name, description FROM test_cases WHERE id = $1 FOR UPDATE', [t.id], db);
    await db.query(
      `UPDATE test_cases SET name = COALESCE($2, name),
              description = CASE WHEN $4 THEN $3 ELSE description END, updated_at = now() WHERE id = $1`,
      [t.id, input.name ?? null, input.description ?? null, input.description !== undefined],
    );
    await audit(req, { orgId: t.org_id, action: 'test_case.updated', entityType: 'test_case', entityId: t.id, diff: changed(before, input) }, db);
    return getTestCase(t.id, db);
  });
  res.json(testCase);
});

contentRouter.delete('/test-cases/:testCaseId', async (req, res) => {
  const t = await requireResource(req, 'testCase', req.params.testCaseId, 'manager');
  await tx(async (db) => {
    await db.query('UPDATE test_cases SET deleted_at = now() WHERE id = $1', [t.id]);
    const rest = await query(
      'SELECT id FROM test_cases WHERE suite_id = $1 AND deleted_at IS NULL ORDER BY position, id',
      [t.suite_id],
      db,
    );
    if (rest.length) await applyOrder(db, 'test_cases', rest.map((r) => r.id));
    await audit(req, { orgId: t.org_id, action: 'test_case.deleted', entityType: 'test_case', entityId: t.id }, db);
  });
  res.status(204).end();
});

// Steps -------------------------------------------------------------------------------------

contentRouter.get('/test-cases/:testCaseId/steps', async (req, res) => {
  const t = await requireResource(req, 'testCase', req.params.testCaseId, 'viewer');
  const steps = await stepsFor([t.id]);
  res.json({ data: steps.get(t.id), nextCursor: null });
});

contentRouter.post('/test-cases/:testCaseId/steps', async (req, res) => {
  const t = await requireResource(req, 'testCase', req.params.testCaseId, 'manager');
  const input = parse(createStepSchema, req.body);
  const step = await tx(async (db) => {
    await db.query('SELECT 1 FROM test_cases WHERE id = $1 FOR UPDATE', [t.id]);
    const count = Number(
      (await one('SELECT count(*) AS n FROM steps WHERE test_case_id = $1 AND deleted_at IS NULL', [t.id], db)).n,
    );
    const position = Math.min(input.position ?? count, count);
    await db.query(
      'UPDATE steps SET position = position + 1 WHERE test_case_id = $1 AND deleted_at IS NULL AND position >= $2',
      [t.id, position],
    );
    const row = await one(
      `INSERT INTO steps (org_id, test_case_id, position, action, expected_result)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [t.org_id, t.id, position, input.action, input.expectedResult ?? null],
      db,
    );
    await db.query('UPDATE test_cases SET updated_at = now() WHERE id = $1', [t.id]);
    await audit(req, { orgId: t.org_id, action: 'step.created', entityType: 'step', entityId: row.id, diff: input }, db);
    return mapStep(await one(`${STEP_SQL} WHERE st.id = $1`, [row.id], db));
  });
  res.status(201).json(step);
});

contentRouter.post('/test-cases/:testCaseId/steps/reorder', async (req, res) => {
  const t = await requireResource(req, 'testCase', req.params.testCaseId, 'manager');
  const { ids } = parse(reorderSchema, req.body);
  await tx(async (db) => {
    const current = await query('SELECT id FROM steps WHERE test_case_id = $1 AND deleted_at IS NULL FOR UPDATE', [t.id], db);
    assertSameSet(current.map((r) => r.id), ids, 'steps in this test case');
    await applyOrder(db, 'steps', ids);
    await audit(req, { orgId: t.org_id, action: 'step.reordered', entityType: 'test_case', entityId: t.id, diff: { ids } }, db);
  });
  res.json({ ids });
});

contentRouter.patch('/steps/:stepId', async (req, res) => {
  const st = await requireResource(req, 'step', req.params.stepId, 'manager');
  const input = parse(updateStepSchema, req.body);
  const step = await tx(async (db) => {
    const before = await one('SELECT action, expected_result AS "expectedResult" FROM steps WHERE id = $1 FOR UPDATE', [st.id], db);
    await db.query(
      `UPDATE steps SET action = COALESCE($2, action),
              expected_result = CASE WHEN $4 THEN $3 ELSE expected_result END, updated_at = now() WHERE id = $1`,
      [st.id, input.action ?? null, input.expectedResult ?? null, input.expectedResult !== undefined],
    );
    await db.query('UPDATE test_cases SET updated_at = now() WHERE id = $1', [st.test_case_id]);
    await audit(req, { orgId: st.org_id, action: 'step.updated', entityType: 'step', entityId: st.id, diff: changed(before, input) }, db);
    return mapStep(await one(`${STEP_SQL} WHERE st.id = $1`, [st.id], db));
  });
  res.json(step);
});

contentRouter.delete('/steps/:stepId', async (req, res) => {
  const st = await requireResource(req, 'step', req.params.stepId, 'manager');
  await tx(async (db) => {
    await db.query('UPDATE steps SET deleted_at = now() WHERE id = $1', [st.id]);
    const rest = await query(
      'SELECT id FROM steps WHERE test_case_id = $1 AND deleted_at IS NULL ORDER BY position, id',
      [st.test_case_id],
      db,
    );
    if (rest.length) await applyOrder(db, 'steps', rest.map((r) => r.id));
    await audit(req, { orgId: st.org_id, action: 'step.deleted', entityType: 'step', entityId: st.id }, db);
  });
  res.status(204).end();
});

function assertSameSet(current: string[], given: string[], what: string) {
  const a = new Set(current);
  const b = new Set(given);
  if (a.size !== b.size || given.length !== b.size || [...a].some((id) => !b.has(id))) {
    throw badRequest(`Send every one of the ${what}, each once, in the new order`);
  }
}
