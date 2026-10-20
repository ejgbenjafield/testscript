-- Reference numbers: projects are numbered 1, 2, 3 within an organisation, and
-- test scripts (suites) 1.1, 1.2 within their project. Numbers are never
-- reused, so a reference like "2.3" always points at the same test script.

ALTER TABLE projects ADD COLUMN number integer;
ALTER TABLE suites ADD COLUMN number integer;

UPDATE projects p SET number = n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY org_id ORDER BY created_at, id) AS rn FROM projects) n
 WHERE n.id = p.id;

UPDATE suites s SET number = n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn FROM suites) n
 WHERE n.id = s.id;

ALTER TABLE projects ALTER COLUMN number SET NOT NULL;
ALTER TABLE suites ALTER COLUMN number SET NOT NULL;
ALTER TABLE projects ADD CONSTRAINT projects_org_number_key UNIQUE (org_id, number);
ALTER TABLE suites ADD CONSTRAINT suites_project_number_key UNIQUE (project_id, number);
