ALTER TABLE pending_email_signups ADD COLUMN member_id TEXT;
ALTER TABLE pending_email_signups ADD COLUMN organization_email TEXT;
ALTER TABLE pending_email_signups ADD COLUMN link_token_hash TEXT;
ALTER TABLE members ADD COLUMN onboarding_required INTEGER NOT NULL DEFAULT 0
  CHECK (onboarding_required IN (0, 1));

CREATE UNIQUE INDEX pending_email_signups_member_id
  ON pending_email_signups(member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX pending_email_signups_organization_email
  ON pending_email_signups(organization_email) WHERE organization_email IS NOT NULL;
