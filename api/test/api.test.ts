import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { pool } from '../src/db';

const app = createApp();

const TABLES = [
  'audit_log', 'billing_events', 'billing_accounts', 'run_results', 'attachments', 'run_test_cases', 'runs',
  'steps', 'test_cases', 'suites', 'projects', 'invitations', 'team_members', 'teams', 'org_members', 'users',
  'organisations',
];

async function login(email: string) {
  const res = await request(app).post('/v1/auth/dev-login').send({ email });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

function as(token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(app).patch(url)).send(body ?? {}),
    delete: (url: string) => auth(request(app).delete(url)),
    upload: (fields: Record<string, string>, file: Buffer, filename: string, contentType: string) => {
      let r = auth(request(app).post('/v1/attachments'));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file, { filename, contentType });
    },
  };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

let owner: ReturnType<typeof as>;
let outsider: ReturnType<typeof as>;
let orgId: string;
let slug: string;

beforeAll(async () => {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  owner = as(await login('owner@acme.test'));
  outsider = as(await login('someone@else.test'));
});

afterAll(async () => {
  await pool.end();
});

describe('auth', () => {
  it('reports the auth mode', async () => {
    const res = await request(app).get('/v1/auth/config');
    expect(res.body).toMatchObject({ mode: 'dev', devLoginEnabled: true });
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects a forged token', async () => {
    const res = await request(app).get('/v1/me').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('returns the signed-in user', async () => {
    const res = await owner.get('/v1/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('owner@acme.test');
    expect(res.body.orgs).toEqual([]);
  });
});

describe('organisations', () => {
  it('creates an org with the creator as owner', async () => {
    const res = await owner.post('/v1/orgs', { name: 'Acme QA' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Acme QA', slug: 'acme-qa', role: 'owner', plan: 'free', seatCount: 1 });
    orgId = res.body.id;
    slug = res.body.slug;
  });

  it('picks a unique slug for a duplicate name', async () => {
    const res = await outsider.post('/v1/orgs', { name: 'Acme QA' });
    expect(res.body.slug).toBe('acme-qa-2');
  });

  it('rejects reserved slugs', async () => {
    const res = await owner.post('/v1/orgs', { name: 'X', slug: 'settings' });
    expect(res.status).toBe(400);
  });

  it('looks orgs up by slug or id', async () => {
    expect((await owner.get(`/v1/orgs/${slug}`)).body.id).toBe(orgId);
    expect((await owner.get(`/v1/orgs/${orgId}`)).body.slug).toBe(slug);
  });

  it('hides other tenants behind 404', async () => {
    expect((await outsider.get(`/v1/orgs/${slug}`)).status).toBe(404);
    expect((await outsider.get(`/v1/orgs/${orgId}/projects`)).status).toBe(404);
  });
});

describe('invitations and roles', () => {
  let tester: ReturnType<typeof as>;
  let viewer: ReturnType<typeof as>;
  let testerId: string;

  it('invites, previews and accepts', async () => {
    const inv = await owner.post(`/v1/orgs/${orgId}/members/invite`, { email: 'Tester@Acme.test', role: 'tester' });
    expect(inv.status).toBe(201);
    expect(inv.body.inviteUrl).toMatch(/\/invite\/[\w-]+$/);
    const token = inv.body.inviteUrl.split('/').pop();

    tester = as(await login('tester@acme.test'));
    const preview = await tester.get(`/v1/invitations/${token}`);
    expect(preview.body).toMatchObject({ orgName: 'Acme QA', role: 'tester', expired: false });

    const wrongPerson = await outsider.post(`/v1/invitations/${token}/accept`);
    expect(wrongPerson.status).toBe(403);

    const accept = await tester.post(`/v1/invitations/${token}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.orgSlug).toBe(slug);

    const again = await outsider.post(`/v1/invitations/${token}/accept`);
    expect(again.status).toBe(410);

    const org = await owner.get(`/v1/orgs/${orgId}`);
    expect(org.body.seatCount).toBe(2);
  });

  it('lists pending invitations and revokes them', async () => {
    const inv = await owner.post(`/v1/orgs/${orgId}/members/invite`, { email: 'viewer@acme.test', role: 'viewer' });
    const list = await owner.get(`/v1/orgs/${orgId}/invitations`);
    expect(list.body.data.map((i: any) => i.email)).toContain('viewer@acme.test');
    expect((await owner.delete(`/v1/orgs/${orgId}/invitations/${inv.body.id}`)).status).toBe(204);
    const token = inv.body.inviteUrl.split('/').pop();
    viewer = as(await login('viewer@acme.test'));
    expect((await viewer.post(`/v1/invitations/${token}/accept`)).status).toBe(404);
  });

  it('adds a viewer', async () => {
    const inv = await owner.post(`/v1/orgs/${orgId}/members/invite`, { email: 'viewer@acme.test', role: 'viewer' });
    const token = inv.body.inviteUrl.split('/').pop();
    expect((await viewer.post(`/v1/invitations/${token}/accept`)).status).toBe(200);
  });

  it('stops people inviting existing members or inviting owners', async () => {
    expect((await owner.post(`/v1/orgs/${orgId}/members/invite`, { email: 'tester@acme.test', role: 'viewer' })).status).toBe(409);
    expect((await owner.post(`/v1/orgs/${orgId}/members/invite`, { email: 'x@acme.test', role: 'owner' })).status).toBe(400);
  });

  it('enforces roles', async () => {
    expect((await tester.post(`/v1/orgs/${orgId}/members/invite`, { email: 'x@acme.test', role: 'viewer' })).status).toBe(403);
    expect((await tester.post(`/v1/orgs/${orgId}/projects`, { name: 'Nope' })).status).toBe(403);
    expect((await viewer.get(`/v1/orgs/${orgId}/projects`)).status).toBe(200);
  });

  it('manages member roles but always keeps an owner', async () => {
    const members = await owner.get(`/v1/orgs/${orgId}/members`);
    expect(members.body.data).toHaveLength(3);
    const ownerId = members.body.data.find((m: any) => m.role === 'owner').userId;
    testerId = members.body.data.find((m: any) => m.email === 'tester@acme.test').userId;

    expect((await owner.patch(`/v1/orgs/${orgId}/members/${ownerId}`, { role: 'admin' })).status).toBe(400);
    expect((await owner.delete(`/v1/orgs/${orgId}/members/${ownerId}`)).status).toBe(400);

    const promoted = await owner.patch(`/v1/orgs/${orgId}/members/${testerId}`, { role: 'manager' });
    expect(promoted.body.role).toBe('manager');
    await owner.patch(`/v1/orgs/${orgId}/members/${testerId}`, { role: 'tester' });
  });

  it('paginates members', async () => {
    const first = await owner.get(`/v1/orgs/${orgId}/members?limit=2`);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await owner.get(`/v1/orgs/${orgId}/members?limit=2&after=${first.body.nextCursor}`);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  describe('content, runs and files', () => {
    let projectId: string;
    let suiteId: string;
    let caseIds: string[] = [];
    let stepIds: string[] = [];
    let runId: string;

    it('creates and edits a project', async () => {
      const res = await owner.post(`/v1/orgs/${orgId}/projects`, { name: 'Web app', description: 'Main site' });
      expect(res.status).toBe(201);
      expect(res.body.number).toBe(1);
      projectId = res.body.id;
      const edited = await owner.patch(`/v1/orgs/${orgId}/projects/${projectId}`, { name: 'Web app v2' });
      expect(edited.body).toMatchObject({ name: 'Web app v2', description: 'Main site' });
    });

    it('blocks cross-tenant access to content', async () => {
      expect((await outsider.get(`/v1/projects/${projectId}/suites`)).status).toBe(404);
      expect((await outsider.post(`/v1/projects/${projectId}/suites`, { areaId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
      expect((await outsider.get('/v1/projects/not-a-uuid/suites')).status).toBe(404);
    });

    it('creates suites, test cases and steps', async () => {
      const area = async (name: string) => (await owner.post(`/v1/orgs/${orgId}/areas`, { name })).body.id as string;
      const checkoutArea = await area('Checkout');
      const searchArea = await area('Search');
      const basketArea = await area('Basket');

      const suite = await owner.post(`/v1/projects/${projectId}/suites`, { areaId: checkoutArea });
      expect(suite.status).toBe(201);
      expect(suite.body).toMatchObject({ ref: '1.1', name: 'Checkout', areaId: checkoutArea });
      suiteId = suite.body.id;
      // An area can only be used once in a project.
      expect((await owner.post(`/v1/projects/${projectId}/suites`, { areaId: checkoutArea })).status).toBe(409);
      const second = await owner.post(`/v1/projects/${projectId}/suites`, { areaId: searchArea });
      expect(second.body.ref).toBe('1.2');
      await owner.delete(`/v1/suites/${second.body.id}`);
      // Numbers aren't reused after a delete.
      const third = await owner.post(`/v1/projects/${projectId}/suites`, { areaId: basketArea });
      expect(third.body.ref).toBe('1.3');
      await owner.delete(`/v1/suites/${third.body.id}`);

      for (const name of ['Pay by card', 'Pay by PayPal', 'Empty basket']) {
        const tc = await owner.post(`/v1/suites/${suiteId}/test-cases`, {
          name,
          steps: [
            { action: `Open checkout for ${name}`, expectedResult: 'Checkout shows' },
            { action: 'Submit the order', expectedResult: 'Confirmation appears' },
          ],
        });
        expect(tc.status).toBe(201);
        expect(tc.body.steps).toHaveLength(2);
        caseIds.push(tc.body.id);
      }
      const inserted = await owner.post(`/v1/test-cases/${caseIds[0]}/steps`, { action: 'Log in first', position: 0 });
      expect(inserted.body.position).toBe(0);
      const steps = await owner.get(`/v1/test-cases/${caseIds[0]}/steps`);
      expect(steps.body.data.map((s: any) => s.action)[0]).toBe('Log in first');
      expect(steps.body.data.map((s: any) => s.position)).toEqual([0, 1, 2]);
      stepIds = steps.body.data.map((s: any) => s.id);
    });

    it('lets admins maintain the list of areas', async () => {
      expect((await tester.post(`/v1/orgs/${orgId}/areas`, { name: 'Payroll' })).status).toBe(403);
      expect((await owner.post(`/v1/orgs/${orgId}/areas`, { name: 'checkout' })).status).toBe(409);
      const list = await viewer.get(`/v1/orgs/${orgId}/areas`);
      expect(list.body.data.map((a: any) => a.name)).toEqual(['Basket', 'Checkout', 'Search']);
      const checkout = list.body.data.find((a: any) => a.name === 'Checkout');
      expect(checkout.usageCount).toBe(1);

      // Renaming an area renames the test areas that use it.
      await owner.patch(`/v1/orgs/${orgId}/areas/${checkout.id}`, { name: 'Checkout flow' });
      expect((await owner.get(`/v1/suites/${suiteId}`)).body.name).toBe('Checkout flow');
      await owner.patch(`/v1/orgs/${orgId}/areas/${checkout.id}`, { name: 'Checkout' });

      // Archived areas leave the dropdown and can't be used for new test areas.
      const basket = list.body.data.find((a: any) => a.name === 'Basket');
      await owner.patch(`/v1/orgs/${orgId}/areas/${basket.id}`, { archived: true });
      expect((await owner.get(`/v1/orgs/${orgId}/areas`)).body.data.map((a: any) => a.name)).not.toContain('Basket');
      expect((await owner.get(`/v1/orgs/${orgId}/areas?includeArchived=true`)).body.data).toHaveLength(3);
      expect((await owner.post(`/v1/projects/${projectId}/suites`, { areaId: basket.id })).status).toBe(400);
      expect((await outsider.get(`/v1/orgs/${orgId}/areas`)).status).toBe(404);
    });

    it('reorders test cases and steps', async () => {
      const order = [caseIds[2], caseIds[0], caseIds[1]];
      expect((await owner.post(`/v1/suites/${suiteId}/test-cases/reorder`, { ids: order })).status).toBe(200);
      const list = await owner.get(`/v1/suites/${suiteId}/test-cases?includeSteps=true`);
      expect(list.body.data.map((t: any) => t.id)).toEqual(order);
      expect(list.body.data[1].steps).toHaveLength(3);

      expect((await owner.post(`/v1/suites/${suiteId}/test-cases/reorder`, { ids: order.slice(0, 2) })).status).toBe(400);

      const stepOrder = [stepIds[1], stepIds[0], stepIds[2]];
      await owner.post(`/v1/test-cases/${caseIds[0]}/steps/reorder`, { ids: stepOrder });
      const steps = await owner.get(`/v1/test-cases/${caseIds[0]}/steps`);
      expect(steps.body.data.map((s: any) => s.id)).toEqual(stepOrder);
      stepIds = stepOrder;
    });

    it('paginates test cases', async () => {
      const first = await owner.get(`/v1/suites/${suiteId}/test-cases?limit=2`);
      expect(first.body.data).toHaveLength(2);
      const rest = await owner.get(`/v1/suites/${suiteId}/test-cases?limit=2&after=${first.body.nextCursor}`);
      expect(rest.body.data).toHaveLength(1);
    });

    it('searches names and step text', async () => {
      const byName = await viewer.get(`/v1/orgs/${slug}/search?q=paypal`);
      expect(byName.body.data[0].testCaseName).toBe('Pay by PayPal');
      const byStep = await viewer.get(`/v1/orgs/${slug}/search?q=${encodeURIComponent('log in')}`);
      expect(byStep.body.data[0]).toMatchObject({ testCaseName: 'Pay by card', matchedStep: 'Log in first' });
      expect((await outsider.get(`/v1/orgs/${slug}/search?q=paypal`)).status).toBe(404);
    });

    it('uploads step files after checking their contents', async () => {
      const ok = await owner.upload({ entityType: 'step', entityId: stepIds[0] }, PNG, 'screen.png', 'image/png');
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ filename: 'screen.png', mimeType: 'image/png', sizeBytes: PNG.length });

      const download = await request(app).get(ok.body.url);
      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toBe('image/png');

      const tampered = await request(app).get(ok.body.url.replace(/sig=[^&]+/, 'sig=nope'));
      expect(tampered.status).toBe(404);

      const fake = await owner.upload({ entityType: 'step', entityId: stepIds[0] }, Buffer.from('<script>alert(1)</script>'), 'x.png', 'image/png');
      expect(fake.status).toBe(415);
      const mismatch = await owner.upload({ entityType: 'step', entityId: stepIds[0] }, PNG, 'x.pdf', 'application/pdf');
      expect(mismatch.status).toBe(415);

      expect((await tester.upload({ entityType: 'step', entityId: stepIds[0] }, PNG, 's.png', 'image/png')).status).toBe(403);
      expect((await outsider.upload({ entityType: 'step', entityId: stepIds[0] }, PNG, 's.png', 'image/png')).status).toBe(404);

      const list = await viewer.get(`/v1/attachments?entityType=step&entityId=${stepIds[0]}`);
      expect(list.body.data).toHaveLength(1);
    });

    it('runs a suite and records results', async () => {
      expect((await viewer.post(`/v1/suites/${suiteId}/runs`, {})).status).toBe(403);
      const run = await tester.post(`/v1/suites/${suiteId}/runs`, { name: 'Release 1.0' });
      expect(run.status).toBe(201);
      runId = run.body.id;
      expect(run.body.testCases).toHaveLength(3);
      expect(run.body.suiteRef).toBe('1.1');
      expect(run.body.stats).toMatchObject({ total: 7, untested: 7, passRate: null });

      const firstCase = run.body.testCases.find((c: any) => c.testCaseId === caseIds[0]);
      const [s1, s2, s3] = firstCase.steps.map((s: any) => s.id);
      await tester.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[0], stepId: s1, result: 'pass' });
      const failed = await tester.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[0], stepId: s2, result: 'fail', notes: 'Button missing' });
      expect(failed.body).toMatchObject({ result: 'fail', notes: 'Button missing' });

      // Changing the result keeps the notes unless they're sent again.
      const changed = await tester.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[0], stepId: s2, result: 'skip' });
      expect(changed.body).toMatchObject({ result: 'skip', notes: 'Button missing' });
      await tester.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[0], stepId: s2, result: 'fail' });
      await tester.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[0], stepId: s3, result: 'pass' });

      const bad = await tester.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[1], stepId: s1, result: 'pass' });
      expect(bad.status).toBe(400);
      expect((await viewer.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[0], stepId: s1, result: 'pass' })).status).toBe(403);

      const shot = await tester.upload({ entityType: 'run_result', entityId: failed.body.id }, PNG, 'bug.png', 'image/png');
      expect(shot.status).toBe(201);

      const detail = await viewer.get(`/v1/runs/${runId}`);
      expect(detail.body.stats).toMatchObject({ passed: 2, failed: 1, untested: 4 });
      expect(detail.body.results.find((r: any) => r.result === 'fail').attachments).toHaveLength(1);
    });

    it('keeps run history when the script changes', async () => {
      await owner.patch(`/v1/test-cases/${caseIds[0]}`, { name: 'Renamed' });
      await owner.delete(`/v1/steps/${stepIds[2]}`);
      const detail = await viewer.get(`/v1/runs/${runId}`);
      const tc = detail.body.testCases.find((c: any) => c.testCaseId === caseIds[0]);
      expect(tc.name).toBe('Pay by card');
      expect(tc.steps).toHaveLength(3);
    });

    it('finishes runs and freezes them', async () => {
      const done = await tester.patch(`/v1/runs/${runId}`, { status: 'completed' });
      expect(done.body.status).toBe('completed');
      expect(done.body.finishedAt).toBeTruthy();
      expect((await tester.patch(`/v1/runs/${runId}`, { status: 'abandoned' })).status).toBe(409);
      const late = await tester.post(`/v1/runs/${runId}/results`, { testCaseId: caseIds[0], stepId: stepIds[0], result: 'pass' });
      expect(late.status).toBe(409);
    });

    it('lists run history', async () => {
      const runs = await viewer.get(`/v1/suites/${suiteId}/runs`);
      expect(runs.body.data).toHaveLength(1);
      expect(runs.body.data[0].stats.passRate).toBeCloseTo(2 / 3);
    });

    it('builds the dashboard', async () => {
      const dash = await viewer.get(`/v1/orgs/${slug}/dashboard`);
      expect(dash.status).toBe(200);
      expect(dash.body.totals).toMatchObject({ projects: 1, suites: 1, testCases: 3, runsLast30Days: 1 });
      expect(dash.body.projects[0].trend).toHaveLength(1);
      expect(dash.body.recentRuns[0]).toMatchObject({ suiteName: 'Checkout', suiteRef: '1.1', projectName: 'Web app v2' });
    });

    it('runs just the chosen test cases', async () => {
      const one = await tester.post(`/v1/suites/${suiteId}/runs`, { testCaseIds: [caseIds[1]] });
      expect(one.status).toBe(201);
      expect(one.body.testCases.map((c: any) => c.testCaseId)).toEqual([caseIds[1]]);
      expect(one.body.stats.total).toBe(2);
      const foreign = await tester.post(`/v1/suites/${suiteId}/runs`, { testCaseIds: ['00000000-0000-4000-8000-000000000000'] });
      expect(foreign.status).toBe(400);
      await tester.patch(`/v1/runs/${one.body.id}`, { status: 'abandoned' });
    });

    it('soft-deletes suites without losing runs', async () => {
      expect((await owner.delete(`/v1/suites/${suiteId}`)).status).toBe(204);
      expect((await owner.get(`/v1/suites/${suiteId}`)).status).toBe(404);
      expect((await viewer.get(`/v1/runs/${runId}`)).status).toBe(200);
    });

    it('writes an audit trail', async () => {
      const { rows } = await pool.query(
        `SELECT action FROM audit_log WHERE org_id = $1`,
        [orgId],
      );
      const actions = rows.map((r) => r.action);
      for (const a of ['org.created', 'member.invited', 'member.joined', 'project.created', 'run.started', 'run_result.recorded', 'run.finished', 'suite.deleted']) {
        expect(actions).toContain(a);
      }
    });
  });

  it('lets members leave', async () => {
    const leave = await tester.delete(`/v1/orgs/${orgId}/members/${testerId}`);
    expect(leave.status).toBe(204);
    expect((await tester.get(`/v1/orgs/${orgId}`)).status).toBe(404);
  });
});
