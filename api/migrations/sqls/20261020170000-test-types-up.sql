-- Each test area is a UAT, Regression or SIT test area. The type decides
-- which fields its test cases and steps use, and which CSV template it takes.
-- Existing test areas become UAT, unless their test cases already use SIT fields.
ALTER TABLE suites ADD COLUMN test_type text NOT NULL DEFAULT 'uat'
  CHECK (test_type IN ('uat', 'regression', 'sit'));
UPDATE suites s SET test_type = 'sit'
 WHERE EXISTS (SELECT 1 FROM test_cases t
                WHERE t.suite_id = s.id AND (t.system IS NOT NULL OR t.import_via IS NOT NULL OR t.import_definition IS NOT NULL));
ALTER TABLE suites ALTER COLUMN test_type DROP DEFAULT;
