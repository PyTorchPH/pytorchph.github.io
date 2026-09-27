import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = path.resolve(process.cwd(), "../..");

test("all Supabase migrations and the deterministic showcase seed execute", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      instance_id uuid,
      aud text,
      role text,
      email text,
      encrypted_password text,
      email_confirmed_at timestamptz,
      raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE auth.identities (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      identity_data jsonb NOT NULL,
      provider text NOT NULL,
      provider_id text NOT NULL,
      last_sign_in_at timestamptz,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE (provider_id, provider)
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text UNIQUE NOT NULL, public boolean NOT NULL DEFAULT false);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
      SELECT string_to_array(name, '/')
    $$;
  `);
  const migrationRoot = path.join(root, "supabase/migrations");
  for (const filename of readdirSync(migrationRoot).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(migrationRoot, filename), "utf8"));
  }
  await db.exec(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  const evidence = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM career_evidence_items");
  const media = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM career_evidence_media WHERE exif_stripped");
  const sources = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM career_evidence_sources WHERE connection_state='connected'");
  assert.equal(evidence.rows[0].count, 3);
  assert.equal(media.rows[0].count, 3);
  assert.equal(sources.rows[0].count, 3);
  await db.exec(`
    INSERT INTO skills (slug,display_name,status,source) VALUES ('unverified-secret','Unverified Secret','candidate','emergent');
    INSERT INTO point_event_skills (point_event_id,skill_id)
    SELECT pe.id,s.id FROM point_events pe CROSS JOIN skills s WHERE pe.description='Vision project recognition' AND s.slug IN ('pytorch','unverified-secret');
  `);
  await db.exec(`
    INSERT INTO career_evidence_items (user_id,evidence_kind,label,normalized_value,title)
    VALUES ('00000000-0000-4000-8000-000000000101','project','Private other-user item','private','Private other-user item');
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT SELECT, INSERT ON career_evidence_items TO authenticated;
    GRANT SELECT ON career_evidence_sources, career_evidence_media, career_evidence_ai_proposals TO authenticated;
    SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
    SET ROLE authenticated;
  `);
  const visible = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM career_evidence_items");
  assert.equal(visible.rows[0].count, 3);
  const detail = await db.query<{ payload: { items: unknown[]; sources: unknown[] } }>("SELECT career_evidence_detail('00000000-0000-4000-8000-000000000001') AS payload");
  assert.equal(detail.rows[0].payload.items.length, 3);
  assert.equal(detail.rows[0].payload.sources.length, 3);
  await assert.rejects(() => db.exec(`INSERT INTO career_evidence_items (user_id,evidence_kind,label,normalized_value,title) VALUES ('00000000-0000-4000-8000-000000000001','project','Browser write','blocked','Browser write')`));
  await assert.rejects(() => db.query("SELECT * FROM leaderboard"));
  await assert.rejects(() => db.query("SELECT * FROM skill_leaderboard"));
  await db.exec("SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',false)");
  const ladder = await db.query<{ payload: { entries: Array<Record<string, unknown>> } }>("SELECT member_leaderboard('2026-q3',NULL,1,25) AS payload");
  assert.ok(ladder.rows[0].payload.entries.length > 0);
  const current = ladder.rows[0].payload.entries.find((entry) => entry.isCurrentUser === true);
  assert.ok(current);
  assert.deepEqual(current!.verifiedSkills, ["PyTorch"]);
  assert.deepEqual(Object.keys(current!).sort(), ["displayLabel","division","isCurrentUser","points","rank","streak","tier","verifiedSkills"].sort());
  const serialized = JSON.stringify(ladder.rows[0].payload);
  for (const forbidden of ["memberId","member_id","email","avatar","bio","department","resume","evidence","sourceUrl","diagnostics","00000000-0000-4000"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  await db.query(`SELECT submit_evidence_envelope(jsonb_build_object(
    'schemaVersion',1,'source','github','origin','extension_scrape','pageUrl','https://github.com/demo-member',
    'collectedAt',now(),'adapterVersion','test-v1','layoutFingerprint',repeat('a',64),'contentHash','sha256:${"d".repeat(64)}',
    'items',jsonb_build_array(jsonb_build_object('title','Pending project evidence','text','A bounded project description.',
      'sourceUrl','https://github.com/demo-member/project','postedAt',NULL,'mediaUrls','[]'::jsonb,'evidenceKind','project',
      'department','academics','proposedLevel','contributor')),'warnings','[]'::jsonb
  ))`);
  const pending = await db.query<{ payload: { view: string; entries: Array<{ isCurrentUser: boolean; points: number; verifiedPoints: number; pendingPoints: number }> } }>("SELECT member_leaderboard('2026-q3',NULL,1,25,'pending') AS payload");
  assert.equal(pending.rows[0].payload.view, "pending");
  const pendingCurrent = pending.rows[0].payload.entries.find((entry) => entry.isCurrentUser);
  assert.equal(pendingCurrent?.points, 40);
  assert.equal(pendingCurrent?.pendingPoints, 40);
  assert.ok((pendingCurrent?.verifiedPoints || 0) > 0);
  await db.exec("RESET ROLE");
  await db.exec(`INSERT INTO leaderboard_seasons(slug,label,starts_at,ends_at,state,rank_policy_version) VALUES ('archive-test','Archive Test',now()-interval '60 days',now()-interval '1 hour','active',1)`);
  await db.exec("SET ROLE authenticated");
  await db.exec("SELECT publish_leaderboard_rank_policy(1); SELECT archive_leaderboard_season('archive-test')");
  const archivedBefore = await db.query<{ payload: { entries: Array<{ isCurrentUser: boolean; points: number }> } }>("SELECT member_leaderboard('archive-test',NULL,1,25) AS payload");
  const archivedPoints = archivedBefore.rows[0].payload.entries.find((entry) => entry.isCurrentUser)!.points;
  await db.exec("RESET ROLE");
  await db.exec(`INSERT INTO point_events(member_id,source,points,weight,description,earned_at) VALUES ('00000000-0000-4000-8000-000000000101','activity',999,1,'Late backfill after archive',now()-interval '2 days')`);
  await db.exec("SET ROLE authenticated");
  const archivedAfter = await db.query<{ payload: { entries: Array<{ isCurrentUser: boolean; points: number }> } }>("SELECT member_leaderboard('archive-test',NULL,1,25) AS payload");
  assert.equal(archivedAfter.rows[0].payload.entries.find((entry) => entry.isCurrentUser)!.points, archivedPoints);
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE anon");
  await assert.rejects(() => db.query("SELECT member_leaderboard(NULL,NULL,1,25)"));
  await assert.rejects(() => db.query("SELECT member_leaderboard(NULL,NULL,1,25,'both')"));
  await assert.rejects(() => db.query("SELECT * FROM leaderboard"));
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE service_role");
  await db.query(`SELECT accept_scraped_evidence(jsonb_build_object(
    'memberId','00000000-0000-4000-8000-000000000001','title','Verified LinkedIn workshop evidence','source','linkedin',
    'sourceUrl','https://www.linkedin.com/feed/update/test','contentHash','sha256:${"b".repeat(64)}',
    'scraperVersion','visible-scraper-v1','scrapedAt',now(),'department','academics','points',250
  ))`);
  await db.exec("RESET ROLE");
  const accepted = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM evidence_claims WHERE provenance='scraped_pending' AND approved_points=0 AND content_hash='sha256:" + "b".repeat(64) + "'");
  assert.equal(accepted.rows[0].count, 1);
  await db.exec("SET ROLE service_role");
  await assert.rejects(() => db.query(`SELECT accept_scraped_evidence(jsonb_build_object(
    'memberId','00000000-0000-4000-8000-000000000001','title','Spoofed Facebook evidence','source','facebook',
    'sourceUrl','https://www.facebook.com/test','contentHash','sha256:${"c".repeat(64)}',
    'scraperVersion','visible-scraper-v1','scrapedAt',now(),'department','academics','points',250
  ))`));
  await db.exec("RESET ROLE");
  await db.close();
});
