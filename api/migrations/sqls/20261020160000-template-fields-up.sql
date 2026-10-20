-- Fields from the UAT, Regression and SIT templates, stored as their own columns.
ALTER TABLE test_cases
  ADD COLUMN precondition text,
  ADD COLUMN system text,
  ADD COLUMN import_via text,
  ADD COLUMN import_definition text;

-- On a step, `action` holds the Question (UAT) or Test Description (SIT).
ALTER TABLE steps ADD COLUMN details text;

-- Runs keep a copy of the test case fields as they were when the run started.
ALTER TABLE run_test_cases ADD COLUMN fields jsonb NOT NULL DEFAULT '{}'::jsonb;
