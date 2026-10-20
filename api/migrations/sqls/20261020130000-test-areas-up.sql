-- Test areas: each test script (suite) is now a "test area" whose name is picked
-- from a list the organisation's admins maintain. The same area can be used in
-- many projects, but only once within a project.

CREATE TABLE areas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Archived areas drop out of the dropdown but stay on test areas already using them.
  archived_at  timestamptz,
  UNIQUE (id, org_id)
);
CREATE UNIQUE INDEX areas_org_name_key ON areas (org_id, lower(name));
CREATE INDEX areas_created_by_idx ON areas (created_by);

-- Existing suites become areas named after themselves. Two suites with the
-- same name in one project would clash, so later ones get " (2)", " (3)" first.
UPDATE suites s SET name = s.name || ' (' || d.rn || ')'
  FROM (SELECT id, row_number() OVER (PARTITION BY project_id, lower(name) ORDER BY created_at, id) AS rn
          FROM suites WHERE deleted_at IS NULL) d
 WHERE d.id = s.id AND d.rn > 1;

INSERT INTO areas (org_id, name, created_at)
SELECT DISTINCT ON (org_id, lower(name)) org_id, name, created_at
  FROM suites ORDER BY org_id, lower(name), created_at;

ALTER TABLE suites ADD COLUMN area_id uuid;
UPDATE suites s SET area_id = a.id FROM areas a WHERE a.org_id = s.org_id AND lower(a.name) = lower(s.name);
ALTER TABLE suites ALTER COLUMN area_id SET NOT NULL;
ALTER TABLE suites ADD FOREIGN KEY (area_id, org_id) REFERENCES areas(id, org_id);
CREATE INDEX suites_area_idx ON suites (area_id);

-- One live test area per area per project.
CREATE UNIQUE INDEX suites_project_area_key ON suites (project_id, area_id)
  WHERE deleted_at IS NULL;
