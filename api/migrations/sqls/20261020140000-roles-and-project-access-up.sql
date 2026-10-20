-- Combinable roles, and project assignment.
--
-- Members (and invitations) now hold a set of roles instead of one rung on a
-- ladder: owner, admin, preparer, tester. No roles means read-only (viewer).
-- The old manager role becomes preparer. Owners and admins see every project;
-- everyone else sees only the projects listed for them in project_members.

ALTER TABLE org_members ADD COLUMN roles text[] NOT NULL DEFAULT '{}';
UPDATE org_members SET roles = CASE role
  WHEN 'owner' THEN ARRAY['owner']
  WHEN 'admin' THEN ARRAY['admin']
  WHEN 'manager' THEN ARRAY['preparer']
  WHEN 'tester' THEN ARRAY['tester']
  ELSE '{}'::text[] END;
ALTER TABLE org_members DROP COLUMN role;
ALTER TABLE org_members ADD CONSTRAINT org_members_roles_check
  CHECK (roles <@ ARRAY['owner', 'admin', 'preparer', 'tester']::text[]);

ALTER TABLE invitations ADD COLUMN roles text[] NOT NULL DEFAULT '{}';
ALTER TABLE invitations ADD COLUMN project_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE invitations SET roles = CASE role
  WHEN 'owner' THEN ARRAY['owner']
  WHEN 'admin' THEN ARRAY['admin']
  WHEN 'manager' THEN ARRAY['preparer']
  WHEN 'tester' THEN ARRAY['tester']
  ELSE '{}'::text[] END;
ALTER TABLE invitations DROP COLUMN role;
ALTER TABLE invitations ADD CONSTRAINT invitations_roles_check
  CHECK (roles <@ ARRAY['owner', 'admin', 'preparer', 'tester']::text[]);

CREATE TABLE project_members (
  project_id  uuid NOT NULL,
  org_id      uuid NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id, org_id) REFERENCES projects(id, org_id) ON DELETE CASCADE,
  -- Leaving the organisation removes their project assignments too.
  FOREIGN KEY (org_id, user_id) REFERENCES org_members(org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX project_members_user_idx ON project_members (org_id, user_id);
CREATE INDEX project_members_added_by_idx ON project_members (added_by);

-- So nobody loses access in the switch: everyone who isn't an owner or admin
-- is assigned to every existing project in their organisation.
INSERT INTO project_members (project_id, org_id, user_id)
SELECT p.id, p.org_id, m.user_id
  FROM projects p JOIN org_members m ON m.org_id = p.org_id
 WHERE p.deleted_at IS NULL AND NOT (m.roles && ARRAY['owner', 'admin']::text[]);
