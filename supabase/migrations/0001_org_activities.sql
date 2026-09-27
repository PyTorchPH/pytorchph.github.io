-- ================================================================
-- Migration 0001: Org Activity Pipeline + Member Profile Foundation
--
-- Implements the full intake → ingest (RAG) → route → brief →
-- approve (parallel, unanimous) → dispatch (HITL) pipeline
-- described in docs/ORG-OPERATIONS.md §8b.
--
-- Also creates the minimal member_profiles table (Layer 1, SPEC §5)
-- required for RLS helper functions used throughout all migrations.
-- Migration 0002 extends member_profiles with public-facing fields.
--
-- TypeScript contracts in domains/protocol/organization/workflow-shape.ts map as follows:
--   ActivityCategory   → activity_category enum
--     "competitive-programming" (TS) → 'competitive_programming' (SQL)
--   Scope              → activity_scope enum
--   Department         → department enum
--     "external-relations" (TS) → 'external_relations' (SQL)
--   IntakeSubmission   → intake_submissions
--   ActivityContext    → activity_contexts
--   RoutingRule        → routing_rules
--   DepartmentBrief    → department_briefs
--   ApprovalVerdict    → approvals
-- ================================================================

-- ----------------------------------------------------------------
-- EXTENSIONS (idempotent)
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------
-- ENUM TYPES
-- Wrapped in DO blocks for idempotent creation.
-- ----------------------------------------------------------------

DO $$ BEGIN
  -- Maps to ActivityCategory in domains/protocol/organization/workflow-shape.ts
  -- Note: SQL uses snake_case; TS uses kebab-case for some values.
  CREATE TYPE activity_category AS ENUM (
    'events',
    'workshops',
    'hackathons',
    'competitive_programming'   -- TS: "competitive-programming"
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Maps to Scope in domains/protocol/organization/workflow-shape.ts
  CREATE TYPE activity_scope AS ENUM (
    'internal',
    'external'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Maps to Department in domains/protocol/organization/workflow-shape.ts
  -- Note: SQL uses snake_case; TS uses kebab-case for some values.
  CREATE TYPE department AS ENUM (
    'secretariat',
    'treasurer',
    'external_relations',       -- TS: "external-relations"
    'academics',
    'executive'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_decision AS ENUM (
    'approve',
    'edit',
    'reject'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_channel AS ENUM (
    'email',
    'facebook'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_status AS ENUM (
    'pending',    -- waiting for human review (HITL gate)
    'approved',   -- human confirmed; queued to send
    'sent',       -- successfully dispatched
    'failed'      -- dispatch error; see error_message
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Tracks which stage of the activity pipeline this record is in.
  CREATE TYPE pipeline_status AS ENUM (
    'intake',       -- submission received; not yet ingested
    'ingesting',    -- RAG/scrape extraction in progress
    'routing',      -- determining required departments
    'briefing',     -- generating per-department briefs
    'approving',    -- waiting for unanimous approval
    'approved',     -- all required departments approved
    'dispatching',  -- downstream HITL actions in progress
    'done',         -- all downstream actions complete
    'rejected'      -- at least one department rejected
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------
-- SHARED TRIGGER: set_updated_at
-- Reused by every table that has an updated_at column.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ================================================================
-- TABLE: member_profiles (LAYER 1 — Auth Foundation)
--
-- Minimal version. Migration 0002 adds display_name, nickname,
-- avatar_url, bio for the public profile / leaderboard layer.
--
-- This table MUST be created before the RLS helper functions below,
-- and before the activity pipeline tables that depend on them.
-- ================================================================
CREATE TABLE IF NOT EXISTS member_profiles (
  id                 uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Roles from SPEC §12. 'anonymous' users have no row here.
  role               text        NOT NULL DEFAULT 'member'
    CHECK (role IN (
      'member',
      'premium',
      'research',
      'moderator',
      'admin',
      'super_admin'
    )),

  -- Officer flag and department assignment (admin-managed only).
  is_officer         boolean     NOT NULL DEFAULT false,
  officer_department department,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- An officer must have a department assigned.
  CONSTRAINT officer_has_department
    CHECK (NOT is_officer OR officer_department IS NOT NULL)
);

-- Partial index: fast lookup of officers per department for RLS.
CREATE INDEX IF NOT EXISTS idx_member_profiles_officers
  ON member_profiles (officer_department)
  WHERE is_officer = true;

-- Composite index for role-check functions (is_admin, etc.).
CREATE INDEX IF NOT EXISTS idx_member_profiles_id_role
  ON member_profiles (id, role);

CREATE OR REPLACE TRIGGER trg_member_profiles_updated_at
  BEFORE UPDATE ON member_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- RLS HELPER FUNCTIONS
--
-- SECURITY DEFINER + owned by postgres → run as postgres (superuser),
-- which has BYPASSRLS. This prevents infinite recursion when these
-- functions are called from RLS policies on member_profiles itself.
--
-- (SELECT auth.uid()) — evaluated ONCE per statement, not per-row.
-- This is the recommended Supabase pattern to avoid O(n) re-evaluation.
-- ================================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM member_profiles
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION is_moderator()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM member_profiles
    WHERE id = (SELECT auth.uid())
      AND role IN ('moderator', 'admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION is_officer()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM member_profiles
    WHERE id = (SELECT auth.uid())
      AND is_officer = true
  );
$$;

-- Returns the calling user's officer department, or NULL if not an officer.
CREATE OR REPLACE FUNCTION officer_dept()
RETURNS department LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT officer_department
  FROM   member_profiles
  WHERE  id = (SELECT auth.uid())
    AND  is_officer = true
  LIMIT 1;
$$;

-- ================================================================
-- TABLE: activities
-- Master record for each org activity item. All child pipeline
-- records (intake, context, briefs, approvals, dispatches) FK here.
-- ================================================================
CREATE TABLE IF NOT EXISTS activities (
  id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  category        activity_category NOT NULL,
  scope           activity_scope    NOT NULL,
  title           text              NOT NULL
    CHECK (char_length(title) BETWEEN 3 AND 200),
  pipeline_status pipeline_status   NOT NULL DEFAULT 'intake',
  created_by      uuid              REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz       NOT NULL DEFAULT now(),
  updated_at      timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_category_scope
  ON activities (category, scope);
CREATE INDEX IF NOT EXISTS idx_activities_status
  ON activities (pipeline_status);
CREATE INDEX IF NOT EXISTS idx_activities_created_by
  ON activities (created_by);

CREATE OR REPLACE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: intake_submissions
-- Any authenticated member may submit a URL or free-text details
-- to start a pipeline (ORG-OPERATIONS.md §2).
-- Constraint: at least one of url or details must be provided.
-- ================================================================
CREATE TABLE IF NOT EXISTS intake_submissions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id  uuid        REFERENCES activities(id) ON DELETE CASCADE,
  submitted_by uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  url          text        CHECK (url ~ '^https?://'),
  details      text,
  submitted_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intake_has_content CHECK (url IS NOT NULL OR details IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_intake_submissions_activity
  ON intake_submissions (activity_id);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_submitted_by
  ON intake_submissions (submitted_by);

-- ================================================================
-- TABLE: activity_contexts
-- Structured output from the LinkIngestor / RAG step.
-- Maps 1:1 to ActivityContext in domains/protocol/organization/workflow-shape.ts.
-- Populated by the AI pipeline (service_role); never by the client.
-- ================================================================
CREATE TABLE IF NOT EXISTS activity_contexts (
  id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid              NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  category    activity_category NOT NULL,
  scope       activity_scope    NOT NULL,
  title       text              NOT NULL,
  summary     text              NOT NULL,
  source_url  text,
  -- Structured facts extracted by AI (dates, org, prizes, requirements...).
  -- Use GIN index below for JSONB containment/key queries.
  facts       jsonb             NOT NULL DEFAULT '{}',
  created_at  timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_contexts_activity
  ON activity_contexts (activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_contexts_facts
  ON activity_contexts USING GIN (facts);

-- ================================================================
-- TABLE: routing_rules
-- Admin-editable configuration: (category, scope) → required
-- departments. Changing routing never requires a code deployment
-- (ORG-OPERATIONS.md §8b pt3).
-- ================================================================
CREATE TABLE IF NOT EXISTS routing_rules (
  id                   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  category             activity_category NOT NULL,
  scope                activity_scope    NOT NULL,
  required_departments department[]      NOT NULL
    CHECK (array_length(required_departments, 1) >= 1),
  created_at           timestamptz       NOT NULL DEFAULT now(),
  updated_at           timestamptz       NOT NULL DEFAULT now(),

  -- Only one routing rule per (category, scope) pair.
  CONSTRAINT routing_rules_unique UNIQUE (category, scope)
);

CREATE OR REPLACE TRIGGER trg_routing_rules_updated_at
  BEFORE UPDATE ON routing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: department_briefs
-- Per-department compacted context + AI-generated draft.
-- The officer edits the draft before final approval.
-- Maps 1:1 to DepartmentBrief in domains/protocol/organization/workflow-shape.ts.
-- ================================================================
CREATE TABLE IF NOT EXISTS department_briefs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id      uuid        NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  department       department  NOT NULL,
  recipient        text        NOT NULL, -- "who the paper is for"
  required_content text        NOT NULL, -- "what the paper must contain"
  draft            text        NOT NULL, -- AI-generated; human edits before approval
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- One brief per (activity, department).
  CONSTRAINT department_briefs_unique UNIQUE (activity_id, department)
);

CREATE INDEX IF NOT EXISTS idx_department_briefs_activity
  ON department_briefs (activity_id);
CREATE INDEX IF NOT EXISTS idx_department_briefs_department
  ON department_briefs (department);

CREATE OR REPLACE TRIGGER trg_department_briefs_updated_at
  BEFORE UPDATE ON department_briefs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- TABLE: approvals
-- One verdict row per (activity, department).
-- All required departments (from routing_rules) must approve
-- before the pipeline proceeds — PARALLEL + UNANIMOUS semantics
-- (ORG-OPERATIONS.md §8b pt4).
--
-- Maps 1:1 to ApprovalVerdict in domains/protocol/organization/workflow-shape.ts.
--
-- Re-submission (edit → re-approve) is handled by DELETE + INSERT
-- or by a new activity revision, not by UPDATE, to preserve
-- the audit trail.
-- ================================================================
CREATE TABLE IF NOT EXISTS approvals (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id      uuid              NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  department       department        NOT NULL,
  approver_user_id uuid              NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  decision         approval_decision NOT NULL,
  note             text,
  decided_at       timestamptz       NOT NULL DEFAULT now(),

  -- One decision record per (activity, department).
  CONSTRAINT approvals_unique UNIQUE (activity_id, department)
);

CREATE INDEX IF NOT EXISTS idx_approvals_activity
  ON approvals (activity_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver
  ON approvals (approver_user_id);
-- For quickly checking if all required departments have approved.
CREATE INDEX IF NOT EXISTS idx_approvals_activity_decision
  ON approvals (activity_id, decision);

-- ================================================================
-- TABLE: dispatch_records
-- One row per downstream channel per activity.
-- Each record is HITL-gated: a human officer MUST set
-- human_approved_by before the pipeline marks status = 'sent'.
-- The AI only drafts content; it never sends autonomously.
-- ================================================================
CREATE TABLE IF NOT EXISTS dispatch_records (
  id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id       uuid             NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  channel           dispatch_channel NOT NULL,
  status            dispatch_status  NOT NULL DEFAULT 'pending',
  drafted_content   text,
  human_approved_by uuid             REFERENCES auth.users(id) ON DELETE SET NULL,
  human_approved_at timestamptz,
  sent_at           timestamptz,
  error_message     text,
  created_at        timestamptz      NOT NULL DEFAULT now(),
  updated_at        timestamptz      NOT NULL DEFAULT now(),

  -- One dispatch record per (activity, channel).
  CONSTRAINT dispatch_records_unique UNIQUE (activity_id, channel),

  -- Database-level HITL invariants:
  -- Cannot transition to 'approved' without recording the approver.
  CONSTRAINT dispatch_approved_requires_approver
    CHECK (status != 'approved' OR human_approved_by IS NOT NULL),
  -- Cannot transition to 'sent' without both an approver and approval timestamp.
  CONSTRAINT dispatch_sent_requires_prior_approval
    CHECK (
      status != 'sent'
      OR (human_approved_by IS NOT NULL AND human_approved_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_dispatch_records_activity
  ON dispatch_records (activity_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_records_status
  ON dispatch_records (status);

CREATE OR REPLACE TRIGGER trg_dispatch_records_updated_at
  BEFORE UPDATE ON dispatch_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================

ALTER TABLE member_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_contexts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_briefs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_records   ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- member_profiles policies
--
-- NOTE on column-level privilege escalation: RLS alone cannot
-- prevent a user from writing to the role/is_officer/officer_department
-- columns on UPDATE, since Postgres RLS operates on whole rows.
-- The application layer (Edge Functions) MUST enforce that only
-- admins may change those fields. This is documented in DATA-MODEL.md.
-- ----------------------------------------------------------------

CREATE POLICY "member_profiles__owner_insert"
  ON member_profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "member_profiles__owner_select"
  ON member_profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY "member_profiles__owner_update"
  ON member_profiles FOR UPDATE TO authenticated
  USING  (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Admins can read all profiles for moderation.
-- is_admin() is SECURITY DEFINER → bypasses RLS on member_profiles
-- → no infinite recursion.
CREATE POLICY "member_profiles__admin_select_all"
  ON member_profiles FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "member_profiles__admin_update_all"
  ON member_profiles FOR UPDATE TO authenticated
  USING  (is_admin())
  WITH CHECK (is_admin());

-- ----------------------------------------------------------------
-- activities policies
-- ----------------------------------------------------------------

-- Any authenticated user can start a pipeline by creating an activity.
CREATE POLICY "activities__auth_insert"
  ON activities FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));

-- Owner, officers, and admins can read activities.
CREATE POLICY "activities__owner_or_officer_select"
  ON activities FOR SELECT TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR is_officer()
    OR is_admin()
  );

-- Officers and admins can update pipeline_status as work progresses.
CREATE POLICY "activities__officer_update"
  ON activities FOR UPDATE TO authenticated
  USING  (is_officer() OR is_admin())
  WITH CHECK (is_officer() OR is_admin());

-- Only admins can delete (soft-delete not implemented here; hard-delete is admin-only).
CREATE POLICY "activities__admin_delete"
  ON activities FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- intake_submissions policies
-- ----------------------------------------------------------------

CREATE POLICY "intake_submissions__auth_insert"
  ON intake_submissions FOR INSERT TO authenticated
  WITH CHECK (submitted_by = (SELECT auth.uid()));

-- Submitter can see their own submission; officers and admins can see all.
CREATE POLICY "intake_submissions__owner_or_officer_select"
  ON intake_submissions FOR SELECT TO authenticated
  USING (
    submitted_by = (SELECT auth.uid())
    OR is_officer()
    OR is_admin()
  );

-- Submissions are immutable once created (pipeline audit trail).
-- No UPDATE/DELETE policy for authenticated users.
-- Admin deletion via service_role only.

-- ----------------------------------------------------------------
-- activity_contexts policies
-- (Populated by AI pipeline via service_role — no client INSERT policy.)
-- ----------------------------------------------------------------

CREATE POLICY "activity_contexts__officer_or_admin_select"
  ON activity_contexts FOR SELECT TO authenticated
  USING (is_officer() OR is_admin());

-- ----------------------------------------------------------------
-- routing_rules policies
-- ----------------------------------------------------------------

-- All authenticated users can read routing rules (officers need visibility).
CREATE POLICY "routing_rules__auth_select"
  ON routing_rules FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "routing_rules__admin_insert"
  ON routing_rules FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "routing_rules__admin_update"
  ON routing_rules FOR UPDATE TO authenticated
  USING  (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "routing_rules__admin_delete"
  ON routing_rules FOR DELETE TO authenticated
  USING (is_admin());

-- ----------------------------------------------------------------
-- department_briefs policies
-- Officers can see and edit briefs for their own department.
-- Admins can see and edit all briefs.
-- ----------------------------------------------------------------

CREATE POLICY "department_briefs__own_dept_select"
  ON department_briefs FOR SELECT TO authenticated
  USING (
    department = officer_dept()
    OR is_admin()
  );

-- Officers may update the draft for their own department's brief.
CREATE POLICY "department_briefs__own_dept_update"
  ON department_briefs FOR UPDATE TO authenticated
  USING  (department = officer_dept() OR is_admin())
  WITH CHECK (department = officer_dept() OR is_admin());

-- Briefs are created by the AI pipeline (service_role).
-- Admin-only INSERT for manual overrides.
CREATE POLICY "department_briefs__admin_insert"
  ON department_briefs FOR INSERT TO authenticated
  WITH CHECK (is_admin());

-- ----------------------------------------------------------------
-- approvals policies
-- ----------------------------------------------------------------

-- Officers can submit their department's verdict.
CREATE POLICY "approvals__own_dept_insert"
  ON approvals FOR INSERT TO authenticated
  WITH CHECK (
    department = officer_dept()
    AND approver_user_id = (SELECT auth.uid())
  );

-- Officers can see approval records for their own department and all
-- records belonging to activities they are party to.
-- Admins see all.
CREATE POLICY "approvals__officer_select"
  ON approvals FOR SELECT TO authenticated
  USING (
    department = officer_dept()
    OR is_admin()
  );

-- Approvals are effectively immutable (UNIQUE constraint prevents
-- re-insertion per activity+department). Revisions require DELETE + INSERT
-- at admin/service_role level. No UPDATE policy for authenticated users.

-- ----------------------------------------------------------------
-- dispatch_records policies
-- Officers (any) can see all dispatch records and approve them (HITL).
-- Admins have full access.
-- Service_role manages INSERT (AI pipeline creates the draft record).
-- ----------------------------------------------------------------

CREATE POLICY "dispatch_records__officer_select"
  ON dispatch_records FOR SELECT TO authenticated
  USING (is_officer() OR is_admin());

-- Officers confirm the HITL gate (update status + human_approved_by).
CREATE POLICY "dispatch_records__officer_update"
  ON dispatch_records FOR UPDATE TO authenticated
  USING  (is_officer() OR is_admin())
  WITH CHECK (is_officer() OR is_admin());

-- Admin-only INSERT for manual dispatch overrides.
CREATE POLICY "dispatch_records__admin_insert"
  ON dispatch_records FOR INSERT TO authenticated
  WITH CHECK (is_admin());
