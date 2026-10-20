DROP TABLE IF EXISTS project_members;

ALTER TABLE invitations ADD COLUMN role org_role NOT NULL DEFAULT 'viewer';
UPDATE invitations SET role = CASE
  WHEN 'owner' = ANY(roles) THEN 'owner'
  WHEN 'admin' = ANY(roles) THEN 'admin'
  WHEN 'preparer' = ANY(roles) THEN 'manager'
  WHEN 'tester' = ANY(roles) THEN 'tester'
  ELSE 'viewer' END::org_role;
ALTER TABLE invitations ALTER COLUMN role DROP DEFAULT;
ALTER TABLE invitations DROP COLUMN roles;
ALTER TABLE invitations DROP COLUMN project_ids;

ALTER TABLE org_members ADD COLUMN role org_role NOT NULL DEFAULT 'viewer';
UPDATE org_members SET role = CASE
  WHEN 'owner' = ANY(roles) THEN 'owner'
  WHEN 'admin' = ANY(roles) THEN 'admin'
  WHEN 'preparer' = ANY(roles) THEN 'manager'
  WHEN 'tester' = ANY(roles) THEN 'tester'
  ELSE 'viewer' END::org_role;
ALTER TABLE org_members ALTER COLUMN role DROP DEFAULT;
ALTER TABLE org_members DROP COLUMN roles;
