ALTER TABLE run_test_cases DROP COLUMN IF EXISTS fields;
ALTER TABLE steps DROP COLUMN IF EXISTS details;
ALTER TABLE test_cases
  DROP COLUMN IF EXISTS precondition,
  DROP COLUMN IF EXISTS system,
  DROP COLUMN IF EXISTS import_via,
  DROP COLUMN IF EXISTS import_definition;
