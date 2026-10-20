import { Router } from 'express';
import { z } from 'zod';
import { scriptRef, type Dashboard, type DashboardProject, type SearchHit } from '@testscript/shared';
import { one, query } from '../db';
import { requireOrg } from '../authz';
import { parse } from '../errors';
import { iso } from '../pagination';
import { mapRunSummary, RUN_SUMMARY_SQL, statsFromRow } from '../runSummary';

export const dashboardRouter = Router();

dashboardRouter.get('/orgs/:orgId/dashboard', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'viewer');

  const totals = await one(
    `SELECT
       (SELECT count(*) FROM projects WHERE org_id = $1 AND deleted_at IS NULL) AS projects,
       (SELECT count(*) FROM suites s JOIN projects p ON p.id = s.project_id
         WHERE s.org_id = $1 AND s.deleted_at IS NULL AND p.deleted_at IS NULL) AS suites,
       (SELECT count(*) FROM test_cases t JOIN suites s ON s.id = t.suite_id JOIN projects p ON p.id = s.project_id
         WHERE t.org_id = $1 AND t.deleted_at IS NULL AND s.deleted_at IS NULL AND p.deleted_at IS NULL) AS test_cases`,
    [org.id],
  );
  const last30 = await one(
    `SELECT count(DISTINCT r.id) AS runs,
            count(rr.id) FILTER (WHERE rr.result = 'pass') AS passed,
            count(rr.id) FILTER (WHERE rr.result = 'fail') AS failed
       FROM runs r LEFT JOIN run_results rr ON rr.run_id = r.id
      WHERE r.org_id = $1 AND r.started_at > now() - interval '30 days'`,
    [org.id],
  );

  const projects = await query(
    `SELECT p.id, p.number, p.name, p.description,
            (SELECT count(*) FROM suites s WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS suite_count,
            (SELECT count(*) FROM test_cases t JOIN suites s ON s.id = t.suite_id
              WHERE s.project_id = p.id AND s.deleted_at IS NULL AND t.deleted_at IS NULL) AS test_case_count,
            (SELECT max(r.started_at) FROM runs r JOIN suites s ON s.id = r.suite_id
              WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS last_run_at,
            (SELECT COALESCE(json_agg(t ORDER BY t.finished_at), '[]') FROM (
               SELECT r.id, r.finished_at, r.total_steps,
                      count(rr.id) FILTER (WHERE rr.result = 'pass') AS passed,
                      count(rr.id) FILTER (WHERE rr.result = 'fail') AS failed,
                      count(rr.id) FILTER (WHERE rr.result = 'skip') AS skipped
                 FROM runs r JOIN suites s ON s.id = r.suite_id
                 LEFT JOIN run_results rr ON rr.run_id = r.id
                WHERE s.project_id = p.id AND s.deleted_at IS NULL AND r.status = 'completed'
                GROUP BY r.id ORDER BY r.finished_at DESC LIMIT 7
            ) t) AS trend
       FROM projects p
      WHERE p.org_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.number
      LIMIT 100`,
    [org.id],
  );

  const runsWithNames = (where: string, limit: number) =>
    query(
      `SELECT x.*, s.name AS suite_name, s.number AS suite_number, p.number AS project_number, p.name AS project_name
         FROM (${RUN_SUMMARY_SQL} WHERE r.org_id = $1 AND ${where} ORDER BY r.started_at DESC LIMIT ${limit}) x
         JOIN suites s ON s.id = x.suite_id JOIN projects p ON p.id = s.project_id
        WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY x.started_at DESC`,
      [org.id],
    );
  const [active, recent] = await Promise.all([
    runsWithNames(`r.status = 'in_progress'`, 10),
    runsWithNames(`r.status <> 'in_progress'`, 10),
  ]);

  const withNames = (r: any) => ({
    ...mapRunSummary(r),
    suiteName: r.suite_name,
    suiteRef: scriptRef(r.project_number, r.suite_number),
    projectName: r.project_name,
  });
  const passed = Number(last30.passed);
  const failed = Number(last30.failed);
  const body: Dashboard = {
    totals: {
      projects: Number(totals.projects),
      suites: Number(totals.suites),
      testCases: Number(totals.test_cases),
      runsLast30Days: Number(last30.runs),
      passRateLast30Days: passed + failed === 0 ? null : passed / (passed + failed),
    },
    projects: projects.map(
      (p): DashboardProject => ({
        id: p.id,
        number: p.number,
        name: p.name,
        description: p.description,
        suiteCount: Number(p.suite_count),
        testCaseCount: Number(p.test_case_count),
        lastRunAt: iso(p.last_run_at),
        trend: p.trend.map((t: any) => ({
          runId: t.id,
          finishedAt: iso(t.finished_at)!,
          passRate: statsFromRow(t).passRate,
        })),
      }),
    ),
    activeRuns: active.map(withNames),
    recentRuns: recent.map(withNames),
  };
  res.json(body);
});

const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Search test case names, descriptions and step text across the organisation. */
dashboardRouter.get('/orgs/:orgId/search', async (req, res) => {
  const org = await requireOrg(req, req.params.orgId, 'viewer');
  const { q, limit } = parse(searchQuery, req.query);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await query(
    `WITH tsq AS (SELECT plainto_tsquery('simple', $2) AS q),
     hits AS (
       SELECT t.id AS test_case_id, NULL::text AS matched_step,
              CASE WHEN t.name ILIKE $3 THEN 2 ELSE 1 END + ts_rank(t.search, tsq.q) AS rank
         FROM test_cases t, tsq
        WHERE t.org_id = $1 AND t.deleted_at IS NULL AND (t.search @@ tsq.q OR t.name ILIKE $3)
       UNION ALL
       SELECT st.test_case_id, st.action, ts_rank(st.search, tsq.q) AS rank
         FROM steps st, tsq
        WHERE st.org_id = $1 AND st.deleted_at IS NULL AND (st.search @@ tsq.q OR st.action ILIKE $3)
     ),
     best AS (
       SELECT DISTINCT ON (test_case_id) test_case_id, matched_step, rank
         FROM hits ORDER BY test_case_id, rank DESC
     )
     SELECT b.test_case_id, b.matched_step, t.name AS test_case_name,
            s.id AS suite_id, s.name AS suite_name, s.number AS suite_number, p.number AS project_number,
            p.id AS project_id, p.name AS project_name
       FROM best b
       JOIN test_cases t ON t.id = b.test_case_id AND t.deleted_at IS NULL
       JOIN suites s ON s.id = t.suite_id AND s.deleted_at IS NULL
       JOIN projects p ON p.id = s.project_id AND p.deleted_at IS NULL
      ORDER BY b.rank DESC, t.name
      LIMIT $4`,
    [org.id, q, like, limit],
  );
  const data: SearchHit[] = rows.map((r) => ({
    testCaseId: r.test_case_id,
    testCaseName: r.test_case_name,
    suiteId: r.suite_id,
    suiteName: r.suite_name,
    suiteRef: scriptRef(r.project_number, r.suite_number),
    projectId: r.project_id,
    projectName: r.project_name,
    matchedStep: r.matched_step,
  }));
  res.json({ data, nextCursor: null });
});
