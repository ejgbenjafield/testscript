ALTER TABLE suites DROP CONSTRAINT IF EXISTS suites_project_number_key;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_org_number_key;
ALTER TABLE suites DROP COLUMN IF EXISTS number;
ALTER TABLE projects DROP COLUMN IF EXISTS number;
