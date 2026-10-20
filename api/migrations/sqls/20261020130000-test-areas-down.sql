DROP INDEX IF EXISTS suites_project_area_key;
DROP INDEX IF EXISTS suites_area_idx;
ALTER TABLE suites DROP COLUMN IF EXISTS area_id;
DROP TABLE IF EXISTS areas;
