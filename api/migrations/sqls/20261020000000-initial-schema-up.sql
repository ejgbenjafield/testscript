-- TestScript initial schema: the full spec data model, so later phases add
-- features rather than restructure tables.
--
-- Tenant isolation: every content table carries org_id, and composite foreign
-- keys (child_id, org_id) -> parent(id, org_id) make it impossible to point a
-- row at another organisation's data.

CREATE TYPE org_role AS ENUM ('viewer', 'tester', 'manager', 'admin', 'owner');
CREATE TYPE run_status AS ENUM ('in_progress', 'completed', 'abandoned');
CREATE TYPE step_result AS ENUM ('pass', 'fail', 'skip');
CREATE TYPE billing_plan AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE attachment_entity AS ENUM ('step', 'run_result');

-- Tenants ---------------------------------------------------------------

CREATE TABLE organisations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  sso_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_id    text NOT NULL UNIQUE,
  email       text NOT NULL,
  name        text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE org_members (
  org_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       org_role NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user_idx ON org_members (user_id);

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);
CREATE INDEX teams_org_idx ON teams (org_id);

CREATE TABLE team_members (
  team_id  uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     org_role NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         org_role NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_org_idx ON invitations (org_id, created_at);

-- Test content ------------------------------------------------------------

CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  team_id      uuid,
  name         text NOT NULL,
  description  text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (team_id, org_id) REFERENCES teams(id, org_id)
);
CREATE INDEX projects_org_created_idx ON projects (org_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX projects_team_idx ON projects (team_id);
CREATE INDEX projects_created_by_idx ON projects (created_by);

CREATE TABLE suites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL,
  name         text NOT NULL,
  description  text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (id, org_id),
  FOREIGN KEY (project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE
);
CREATE INDEX suites_project_idx ON suites (project_id) WHERE deleted_at IS NULL;
CREATE INDEX suites_org_created_idx ON suites (org_id, created_at);
CREATE INDEX suites_created_by_idx ON suites (created_by);

CREATE TABLE test_cases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  suite_id     uuid NOT NULL,
  name         text NOT NULL,
  description  text,
  position     integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  search       tsvector GENERATED ALWAYS AS
                 (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED,
  UNIQUE (id, org_id),
  FOREIGN KEY (suite_id, org_id) REFERENCES suites(id, org_id) ON DELETE CASCADE
);
CREATE INDEX test_cases_suite_idx ON test_cases (suite_id, position) WHERE deleted_at IS NULL;
CREATE INDEX test_cases_org_created_idx ON test_cases (org_id, created_at);
CREATE INDEX test_cases_search_idx ON test_cases USING gin (search);
CREATE INDEX test_cases_created_by_idx ON test_cases (created_by);

CREATE TABLE steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  test_case_id     uuid NOT NULL,
  position         integer NOT NULL DEFAULT 0,
  action           text NOT NULL,
  expected_result  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  search           tsvector GENERATED ALWAYS AS
                     (to_tsvector('simple', coalesce(action, '') || ' ' || coalesce(expected_result, ''))) STORED,
  UNIQUE (id, org_id),
  FOREIGN KEY (test_case_id, org_id) REFERENCES test_cases(id, org_id) ON DELETE CASCADE
);
CREATE INDEX steps_test_case_idx ON steps (test_case_id, position) WHERE deleted_at IS NULL;
CREATE INDEX steps_org_created_idx ON steps (org_id, created_at);
CREATE INDEX steps_search_idx ON steps USING gin (search);

-- Execution -----------------------------------------------------------------

CREATE TABLE runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  suite_id     uuid NOT NULL,
  name         text NOT NULL,
  started_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       run_status NOT NULL DEFAULT 'in_progress',
  total_steps  integer NOT NULL DEFAULT 0,
  UNIQUE (id, org_id),
  FOREIGN KEY (suite_id, org_id) REFERENCES suites(id, org_id) ON DELETE CASCADE
);
CREATE INDEX runs_suite_idx ON runs (suite_id, started_at DESC);
CREATE INDEX runs_org_created_idx ON runs (org_id, started_at);
CREATE INDEX runs_org_status_idx ON runs (org_id, status);
CREATE INDEX runs_started_by_idx ON runs (started_by);

-- What a run is testing, frozen when it starts. Editing or deleting the suite
-- afterwards never changes run history.
CREATE TABLE run_test_cases (
  run_id        uuid NOT NULL,
  org_id        uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  test_case_id  uuid NOT NULL,
  position      integer NOT NULL,
  name          text NOT NULL,
  description   text,
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (run_id, test_case_id),
  FOREIGN KEY (run_id, org_id) REFERENCES runs(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id, org_id) REFERENCES test_cases(id, org_id) ON DELETE CASCADE
);
CREATE INDEX run_test_cases_test_case_idx ON run_test_cases (test_case_id);

CREATE TABLE run_results (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  run_id                    uuid NOT NULL,
  test_case_id              uuid NOT NULL,
  step_id                   uuid NOT NULL,
  result                    step_result NOT NULL,
  notes                     text,
  screenshot_attachment_id  uuid,
  recorded_at               timestamptz NOT NULL DEFAULT now(),
  recorded_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (id, org_id),
  UNIQUE (run_id, step_id),
  FOREIGN KEY (run_id, org_id) REFERENCES runs(id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, test_case_id) REFERENCES run_test_cases(run_id, test_case_id) ON DELETE CASCADE
);
CREATE INDEX run_results_org_created_idx ON run_results (org_id, recorded_at);
CREATE INDEX run_results_recorded_by_idx ON run_results (recorded_by);

CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entity_type  attachment_entity NOT NULL,
  entity_id    uuid NOT NULL,
  uploader_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  filename     text NOT NULL,
  storage_key  text NOT NULL UNIQUE,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (id, org_id)
);
CREATE INDEX attachments_entity_idx ON attachments (entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX attachments_org_created_idx ON attachments (org_id, created_at);
CREATE INDEX attachments_uploader_idx ON attachments (uploader_id);

ALTER TABLE run_results
  ADD FOREIGN KEY (screenshot_attachment_id, org_id) REFERENCES attachments(id, org_id);

-- Billing hooks (Stripe arrives in Phase 3) ------------------------------------

CREATE TABLE billing_accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
  stripe_customer_id      text UNIQUE,
  stripe_subscription_id  text UNIQUE,
  plan                    billing_plan NOT NULL DEFAULT 'free',
  seat_count              integer NOT NULL DEFAULT 1,
  payment_failed_at       timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_events_org_created_idx ON billing_events (org_id, created_at);

-- Audit ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  diff         jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_created_idx ON audit_log (org_id, created_at);
CREATE INDEX audit_log_user_idx ON audit_log (user_id);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
