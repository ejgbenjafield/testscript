import { Router } from 'express';
import {
  paginationSchema,
  recordResultSchema,
  startRunSchema,
  updateRunSchema,
  type Attachment,
  type RunDetail,
  type RunResult,
  type RunTestCase,
  scriptRef,
} from '@testscript/shared';
import { one, query, tx } from '../db';
import { audit, currentUser, requireResource } from '../authz';
import { badRequest, conflict, parse } from '../errors';
import { iso, toPage } from '../pagination';
import { mapRunSummary, RUN_SUMMARY_SQL } from '../runSummary';
import { attachmentsFor } from './attachments';

export const runsRouter = Router();

function defaultRunName(date = new Date()) {
  return `Run ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

runsRouter.post('/suites/:suiteId/runs', async (req, res) => {
  const user = currentUser(req);
  const s = await requireResource(req, 'suite', req.params.suiteId, 'runTests');
  const input = parse(startRunSchema, req.body);

  const runId = await tx(async (db) => {
    const cases = await query(
      `SELECT t.id, t.name, t.description, t.position,
              COALESCE(json_agg(json_build_object('id', st.id, 'ref', st.ref, 'position', st.position, 'action', st.action,
                       'expectedResult', st.expected_result) ORDER BY st.position)
                       FILTER (WHERE st.id IS NOT NULL), '[]') AS steps
         FROM test_cases t
         LEFT JOIN steps st ON st.test_case_id = t.id AND st.deleted_at IS NULL
        WHERE t.suite_id = $1 AND t.deleted_at IS NULL
          AND ($2::uuid[] IS NULL OR t.id = ANY($2::uuid[]))
        GROUP BY t.id ORDER BY t.position, t.id`,
      [s.id, input.testCaseIds ?? null],
      db,
    );
    if (input.testCaseIds && cases.length !== new Set(input.testCaseIds).size) {
      throw badRequest('Some of those test cases are not in this test script');
    }
    const withSteps = cases.filter((c) => c.steps.length > 0);
    if (withSteps.length === 0) {
      throw badRequest('Add at least one test case with steps before starting a run');
    }
    const totalSteps = withSteps.reduce((n, c) => n + c.steps.length, 0);
    const run = await one(
      `INSERT INTO runs (org_id, suite_id, name, started_by, total_steps) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [s.org_id, s.id, input.name || defaultRunName(), user.id, totalSteps],
      db,
    );
    for (const [i, c] of withSteps.entries()) {
      await db.query(
        `INSERT INTO run_test_cases (run_id, org_id, test_case_id, position, name, description, steps)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [run.id, s.org_id, c.id, i, c.name, c.description, JSON.stringify(c.steps)],
      );
    }
    await audit(req, { orgId: s.org_id, action: 'run.started', entityType: 'run', entityId: run.id, diff: { suiteId: s.id, testCases: withSteps.length, steps: totalSteps } }, db);
    return run.id as string;
  });

  res.status(201).json(await loadRun(runId));
});

runsRouter.get('/suites/:suiteId/runs', async (req, res) => {
  const s = await requireResource(req, 'suite', req.params.suiteId, 'read');
  const { after, limit } = parse(paginationSchema, req.query);
  const rows = await query(
    `${RUN_SUMMARY_SQL}
      WHERE r.suite_id = $1
        AND ($2::uuid IS NULL OR (r.started_at, r.id) < (SELECT started_at, id FROM runs WHERE id = $2))
      ORDER BY r.started_at DESC, r.id DESC LIMIT $3`,
    [s.id, after ?? null, limit + 1],
  );
  res.json(toPage(rows, limit, mapRunSummary));
});

async function loadRun(runId: string): Promise<RunDetail> {
  const run = await one(
    `SELECT x.*, s.name AS suite_name, s.number AS suite_number, p.number AS project_number,
            p.id AS project_id, p.name AS project_name
       FROM (${RUN_SUMMARY_SQL} WHERE r.id = $1) x
       JOIN suites s ON s.id = x.suite_id JOIN projects p ON p.id = s.project_id`,
    [runId],
  );
  const cases = await query(
    'SELECT test_case_id, position, name, description, steps FROM run_test_cases WHERE run_id = $1 ORDER BY position',
    [runId],
  );
  const results = await query(
    `SELECT rr.*, u.name AS recorder_name, u.email AS recorder_email
       FROM run_results rr LEFT JOIN users u ON u.id = rr.recorded_by
      WHERE rr.run_id = $1`,
    [runId],
  );
  const files = await attachmentsFor('run_result', results.map((r) => r.id));
  const testCases: RunTestCase[] = cases.map((c) => ({
    testCaseId: c.test_case_id,
    position: c.position,
    name: c.name,
    description: c.description,
    steps: c.steps,
  }));
  return {
    ...mapRunSummary(run),
    suiteName: run.suite_name,
    suiteRef: scriptRef(run.project_number, run.suite_number),
    projectId: run.project_id,
    projectName: run.project_name,
    testCases,
    results: results.map((r) => mapResult(r, files.get(r.id) ?? [])),
  };
}

function mapResult(r: any, attachments: Attachment[]): RunResult {
  return {
    id: r.id,
    testCaseId: r.test_case_id,
    stepId: r.step_id,
    result: r.result,
    notes: r.notes,
    recordedAt: iso(r.recorded_at)!,
    recordedBy: r.recorded_by ? { id: r.recorded_by, name: r.recorder_name, email: r.recorder_email } : null,
    attachments,
  };
}

runsRouter.get('/runs/:runId', async (req, res) => {
  const run = await requireResource(req, 'run', req.params.runId, 'read');
  res.json(await loadRun(run.id));
});

runsRouter.patch('/runs/:runId', async (req, res) => {
  const run = await requireResource(req, 'run', req.params.runId, 'runTests');
  const { status } = parse(updateRunSchema, req.body);
  await tx(async (db) => {
    const updated = await one(
      `UPDATE runs SET status = $2, finished_at = now() WHERE id = $1 AND status = 'in_progress' RETURNING id`,
      [run.id, status],
      db,
    );
    if (!updated) throw conflict('This run has already finished');
    await audit(req, { orgId: run.org_id, action: status === 'completed' ? 'run.finished' : 'run.abandoned', entityType: 'run', entityId: run.id }, db);
  });
  res.json(await loadRun(run.id));
});

runsRouter.post('/runs/:runId/results', async (req, res) => {
  const user = currentUser(req);
  const run = await requireResource(req, 'run', req.params.runId, 'runTests');
  const input = parse(recordResultSchema, req.body);
  if (run.status !== 'in_progress') throw conflict('This run has finished, so results can no longer change');

  const result = await tx(async (db) => {
    const tc = await one(
      `SELECT 1 FROM run_test_cases
        WHERE run_id = $1 AND test_case_id = $2 AND steps @> jsonb_build_array(jsonb_build_object('id', $3::text))`,
      [run.id, input.testCaseId, input.stepId],
      db,
    );
    if (!tc) throw badRequest('That step is not part of this run');
    const row = await one(
      `INSERT INTO run_results (org_id, run_id, test_case_id, step_id, result, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (run_id, step_id) DO UPDATE
         SET result = EXCLUDED.result,
             notes = CASE WHEN $8 THEN EXCLUDED.notes ELSE run_results.notes END,
             recorded_at = now(), recorded_by = EXCLUDED.recorded_by
       RETURNING *`,
      [run.org_id, run.id, input.testCaseId, input.stepId, input.result, input.notes ?? null, user.id, input.notes !== undefined],
      db,
    );
    await audit(req, { orgId: run.org_id, action: 'run_result.recorded', entityType: 'run_result', entityId: row.id, diff: { stepId: input.stepId, result: input.result } }, db);
    return row;
  });
  const files = await attachmentsFor('run_result', [result.id]);
  res.json(mapResult({ ...result, recorder_name: user.name, recorder_email: user.email }, files.get(result.id) ?? []));
});

runsRouter.delete('/run-results/:resultId', async (req, res) => {
  const rr = await requireResource(req, 'runResult', req.params.resultId, 'runTests');
  if (rr.run_status !== 'in_progress') throw conflict('This run has finished, so results can no longer change');
  await tx(async (db) => {
    await db.query(
      `UPDATE attachments SET deleted_at = now() WHERE entity_type = 'run_result' AND entity_id = $1 AND deleted_at IS NULL`,
      [rr.id],
    );
    await db.query('DELETE FROM run_results WHERE id = $1', [rr.id]);
    await audit(req, { orgId: rr.org_id, action: 'run_result.cleared', entityType: 'run_result', entityId: rr.id }, db);
  });
  res.status(204).end();
});
