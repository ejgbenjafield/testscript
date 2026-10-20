# TestScript — Phase 1 (Core Platform MVP), built for Replit

Multi-tenant manual test case management: organisations → projects → suites → test cases → steps, test runs with per-step Pass / Fail / Skip, screenshots and files on steps and results, a dashboard with pass-rate trends, and run history.

```
testscript/
├── shared/      @testscript/shared: roles, request schemas, API types, result/status logic
├── api/         Express + TypeScript REST API (/v1), node-postgres, db-migrate migrations
├── frontend/    React + Vite + TypeScript + Tailwind + React Query + Zustand
├── .replit      Run button and Publish settings
└── package.json npm workspaces
```

On Replit everything runs in one app: Replit's PostgreSQL holds the data, Replit Object Storage holds uploaded files, and in the published app a single server on port 5000 serves both the website and the API.

## Run it on Replit

1. **Import the code.** In Replit choose **Create App → Import from GitHub** and pick `testscript`.
2. **Add a database.** Open the **Database** tool and create a PostgreSQL database. Replit adds `DATABASE_URL` for you.
3. **Add file storage.** Open the **Object Storage** tool and create a bucket. Uploads go to the app's default bucket.
4. **Press Run.** The first run installs packages (a minute or two), creates the database tables, then starts the API on port 8080 and the website on port 5000, which shows in the preview.
5. **Sign in** with any email (development sign-in, no password). Create an organisation, a project, a suite and some test cases, then start a run.

To try invitations: invite someone from **Members**, copy the link (email isn't sent until SendGrid is set up), open it in a private window and sign in with the invited address.

## Publish it

1. Click **Publish** and choose **Autoscale**. The build and run commands come from `.replit`.
2. Let Replit create the **production database** when it offers. The published app gets its own database, separate from the one you build with; tables are created automatically each time the app starts.
3. Add these **secrets to the published app** (workspace secrets don't carry over):
   - `APP_SIGNING_SECRET`: any long random string. Required; the app won't start without it.
   - The Auth0 settings below, once you've set Auth0 up.
4. Your site is live at its `.replit.app` address. Add a custom domain in the published app's settings if you have one.

**Sign-in in the published app.** Development sign-in lets anyone in as anyone, so it's switched off in published apps. Until Auth0 is set up the login page explains this. For a private preview only, you can add the secret `ALLOW_DEV_LOGIN=true`.

## Set up real logins (Auth0)

1. **Create an API** in Auth0: identifier `https://api.testscript.app` (this is the *audience*), RS256, token expiry 900 s, **Allow Offline Access** on.
2. **Create a Single Page Application.** Replace the addresses with your own:
   - Allowed Callback URLs: `https://YOUR-PREVIEW.replit.dev/callback, https://YOUR-APP.replit.app/callback`
   - Allowed Logout URLs and Allowed Web Origins: `https://YOUR-PREVIEW.replit.dev, https://YOUR-APP.replit.app`
   - Refresh Token Rotation on. Absolute and inactivity lifetime: 7 days.
3. **Connections:** enable *Username-Password-Authentication* and *google-oauth2* for the app.
4. **Add a post-login Action** (Actions → Library → Build custom → Login flow) so the API receives the user's profile:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const ns = 'https://testscript.app/';
     if (event.authorization) {
       api.accessToken.setCustomClaim(ns + 'email', event.user.email);
       api.accessToken.setCustomClaim(ns + 'email_verified', event.user.email_verified);
       api.accessToken.setCustomClaim(ns + 'name', event.user.name);
       api.accessToken.setCustomClaim(ns + 'picture', event.user.picture);
     }
   };
   ```

5. **Add secrets** in Replit (in the workspace, and again for the published app):
   `AUTH_MODE=auth0`, `AUTH0_DOMAIN` (e.g. `your-tenant.eu.auth0.com`), `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE=https://api.testscript.app`.

The website reads these from the API at start-up, so there's nothing to set for the frontend.

## Optional settings

| Secret | What it does |
|---|---|
| `APP_URL` | Public address used in invite links, e.g. `https://testscript.replit.app`. Worked out from the request if not set. |
| `SENDGRID_API_KEY`, `EMAIL_FROM` | Send invitation emails. Without them, the invite link is shown to copy. |
| `REPLIT_BUCKET_ID` | Use a specific Object Storage bucket instead of the default one. |
| `STORAGE_DRIVER` | `replit` or `local`. Chosen automatically. |

## Working outside Replit

Needs Node 22 and PostgreSQL 16.

```bash
npm install
cp api/.env.example api/.env        # set DATABASE_URL
npm run migrate
npm run dev                         # API on :8080, website on :5173
```

Uploaded files go to `api/data/uploads` when not on Replit.

**Tests** run against a separate database (default `postgres://testscript:testscript@localhost:5432/testscript_test`, override with `TEST_DATABASE_URL`):

```bash
npm test          # shared unit tests + API integration tests
npm run typecheck
```

The API suite (`api/test/api.test.ts`) covers sign-in, organisations, invitations, role enforcement, cross-tenant isolation, CRUD with reordering, pagination, search, file uploads (including content checks), runs and results, finishing runs, run history, the dashboard and the audit trail.

## Phase 1 checklist (spec §15)

| # | Item | Where |
|---|---|---|
| 1 | Monorepo `/frontend`, `/api`, `/shared` | npm workspaces |
| 2 | Schema + migrations (`node-postgres` + `db-migrate`) | `api/migrations/`, run by `api/scripts/migrate.js` (the full spec schema, so later phases add rather than restructure) |
| 3 | Auth0 (email/password + Google) | `api/src/middleware/auth.ts`, `frontend/src/auth/` |
| 4 | Multi-tenant orgs + members | `api/src/routes/orgs.ts`, Members and Settings pages |
| 5 | CRUD: projects, suites, test cases, steps | `api/src/routes/content.ts`, Project and Suite pages (inline edit, drag-and-drop reorder) |
| 6 | Test runs + result recording | `api/src/routes/runs.ts`, Run page |
| 7 | Dashboard + results history | `api/src/routes/dashboard.ts`, Dashboard page, suite **Run history** tab |
| 8 | Attachments on steps and run results | `api/src/routes/attachments.ts`, `api/src/storage.ts` (Replit Object Storage) |
| 9 | Hosted staging deploy | `.replit` (Replit Autoscale instead of Cloud Run) |

## Design decisions and changes from the spec

- **Test areas and reference numbers.** What the spec calls a *suite* is shown as a **test area** on the website (the code and API still say `suite`). Its name is picked from the organisation's list of areas, which admins maintain under **Settings**; an area can be used in many projects but once per project, and renaming it renames it everywhere. Projects are numbered 1, 2, 3 within an organisation and test areas 1.1, 1.2 within their project. Numbers are assigned automatically and never reused.
- **Running part of a test area.** A run can include every test case, or just the ones you tick (or a single one, from its **Run** button).
- **Template fields.** Test cases have every field from the UAT, Regression and SIT templates as its own field: Test Case ID, Name, Description, Pre-condition, System, Import via and Import Definition. Steps have the Question (or SIT Test Description), Details to Validate and Expected Result. All are editable on the test area page, shown during runs, and kept in each run's snapshot.
- **CSV upload.** On a test area, **Upload CSV** adds test cases from the UAT, Regression or SIT template (downloadable from the same dialog, and in `frontend/public/templates/`). In every template each row is a step, grouped into test cases by ID (REPORT1.0, REPORT1.1 → steps 1 and 2 of test case REPORT1). SIT test cases are named after their Import Definition, and each step keeps its full Test Description; older SIT files without an ID become one test case per row. The file is checked first and nothing is saved until you confirm; test cases whose ID is already in the test area are skipped, so re-uploading is safe. Result columns (Actual Results, Pass/Fail, Test Performer, Comments) are ignored because results are recorded in the app. Each column goes into its matching field.
- **Members and Settings.** **Members** is a grid of everyone in the organisation and everyone invited, with roles and actions. **Settings** (admins only) holds organisation-wide options: the area list and the organisation's name and address.
- **Replit instead of Google Cloud.** Replit PostgreSQL replaces Cloud SQL, Replit Object Storage (backed by Google Cloud Storage) replaces the GCS bucket, Replit Secrets replaces Secret Manager, and Replit Autoscale replaces Cloud Run. One server serves the website and the API, so there's no CORS to configure.
- **Tenant isolation.** `org_id` is on every content table, and composite foreign keys (`(suite_id, org_id) → suites(id, org_id)`) make cross-organisation references impossible in the database itself. Every route finds the organisation that owns what it touches and checks the caller's role there (`api/src/authz.ts`). Non-members get **404**, not 403, so other tenants' ids can't be probed.
- **Roles combine, and people see only their projects.** Members get any mix of **Owner**, **Admin**, **Preparer** and **Tester**, ticked as checkboxes in the Members grid; no roles means read-only (Viewer). Only Admins and Owners create, rename and delete projects, manage members and change Settings, and only they see every project. Preparers add and edit test areas, test cases and steps and run tests; Testers run tests. Everyone else sees only the projects an admin has assigned them to (`project_members`), in every list, the dashboard, search and direct links, which return 404 otherwise. Only owners can grant or remove Owner, and there's always at least one. The old ladder roles were migrated (manager → preparer), and existing non-admin members were assigned to every existing project so nobody lost access. Spec-style teams are replaced by project assignment.
- **Auth endpoints.** Auth0's SPA SDK handles token, refresh and logout itself: access tokens stay **in memory** and renew with rotating refresh tokens. The API only verifies tokens. Development sign-in (`/v1/auth/dev-login`) issues signed tokens and is disabled in published apps.
- **Uploads.** Files go through the API (`POST /v1/attachments`, multipart) rather than a signed upload URL, because Replit Object Storage doesn't hand out browser upload URLs. The API checks size (50 MB), **sniffs the file's first bytes** against PNG, JPG, GIF, WebP, MP4 and PDF, and rejects files whose contents don't match their declared type. Downloads use **signed links that expire after an hour**, served with `nosniff` and a sandboxing CSP. Virus scanning is Phase 2; `attachments.ts` marks where it plugs in.
- **Soft deletes** on projects, suites, test cases and steps, plus a `run_test_cases` snapshot taken when a run starts. Editing or deleting a suite never rewrites run history.
- **Results** are upserted per step (last write wins) and saved on each click, with optimistic UI and rollback. This replaces the 30-second auto-save; notes save when the field loses focus. While a run is live the page checks for others' results every 10 seconds. Socket.io presence arrives in Phase 2 (on a Reserved VM).
- **Invitations** use single-use tokens stored as SHA-256 hashes, expire after 7 days, require the signed-in email to match, and require a verified email in Auth0 mode.
- **Audit log.** Every change writes to `audit_log` now; the admin viewer is Phase 2.
- **Billing hooks.** Each new organisation gets a `billing_accounts` row (plan `free`) and the seat count updates as people join and leave. Stripe is Phase 3.
- **URLs.** Organisation routing is path-based (`/acme-qa/dashboard`), matching spec §7. Per-organisation subdomains come with custom domains in Phase 3.
- **Not in Phase 1:** rate limiting, real-time collaboration, SSO/SAML, imports, reporting charts, exports, public share links.

## API overview

All routes are under `/v1` and need `Authorization: Bearer <jwt>`, except `/v1/auth/*`, signed file links and `/healthz`. Errors look like `{ "error": { "code", "message", "details" } }`. Lists return `{ data, nextCursor }` (`?after=<id>&limit=50`). `:orgId` accepts the organisation's id or its web address (slug).

```
GET    /auth/config                           POST /auth/dev-login
GET    /me
POST   /orgs                                  GET/PATCH /orgs/:orgId
GET    /orgs/:orgId/members                   PATCH/DELETE /orgs/:orgId/members/:userId  {roles}   PUT /orgs/:orgId/members/:userId/projects  {projectIds}
POST   /orgs/:orgId/members/invite {email, roles, projectIds}           GET /orgs/:orgId/invitations   DELETE /orgs/:orgId/invitations/:id
GET    /invitations/:token                    POST /invitations/:token/accept
GET    /orgs/:orgId/dashboard                 GET /orgs/:orgId/search?q=
GET/POST /orgs/:orgId/areas                   PATCH /orgs/:orgId/areas/:areaId  {name?, archived?}
GET/POST         /orgs/:orgId/projects        GET/PATCH/DELETE /orgs/:orgId/projects/:projectId
GET/POST         /projects/:projectId/suites  GET/PATCH/DELETE /suites/:suiteId
GET/POST         /suites/:suiteId/test-cases  POST /suites/:suiteId/test-cases/reorder
GET/PATCH/DELETE /test-cases/:testCaseId
GET/POST         /test-cases/:testCaseId/steps   POST /test-cases/:testCaseId/steps/reorder
PATCH/DELETE     /steps/:stepId
POST   /suites/:suiteId/runs                  GET /suites/:suiteId/runs
GET    /runs/:runId                           PATCH /runs/:runId  {status: completed|abandoned}
POST   /runs/:runId/results                   DELETE /run-results/:resultId
POST   /suites/:suiteId/import?preview=true (multipart CSV)
POST   /attachments (multipart)               GET /attachments?entityType&entityId
GET    /attachments/:id/content?exp&sig       DELETE /attachments/:attachmentId
```

## Next: Phase 2

Socket.io real-time runs, team management with team-scoped roles, per-organisation SAML via Auth0 Organizations, Jira and TestRail imports, and the audit log viewer and admin panel. Real-time needs an always-on server, so the published app moves from Autoscale to a Reserved VM then.
