-- Reference ids from imported spreadsheets, e.g. test case "REPORT1" with
-- steps "REPORT1.0", "REPORT1.1". Kept so people can match TestScript back to
-- their files, and so re-uploading a file doesn't create duplicates.
ALTER TABLE test_cases ADD COLUMN ref text;
ALTER TABLE steps ADD COLUMN ref text;
CREATE INDEX test_cases_suite_ref_idx ON test_cases (suite_id, lower(ref)) WHERE deleted_at IS NULL AND ref IS NOT NULL;
