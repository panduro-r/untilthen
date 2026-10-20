-- Supabase Data API change (2026-10-30): tables created in "public" from that date are no longer
-- auto-granted to anon / authenticated / service_role; each needs an explicit GRANT. Existing tables
-- keep their grants, so the live app is unaffected. This migration makes the schema independent of
-- that default, and finishes the client-role cleanup 0011 started.
--
-- Why it matters here: the app reaches Postgres ONLY as service_role (lib/db.supabase.ts), and
-- 0001/0006 created every table relying on the old implicit service_role grant. Rebuilding the schema
-- from these migrations after the cutover — a new project, disaster recovery, a preview branch, or a
-- local reset — would leave service_role without access, and every route would fail with
-- "permission denied". The explicit grants below run after all tables exist, so a rebuild works.
--
-- Convention from here on: a migration that creates a table must grant service_role in the same file
-- (select, insert, update, delete) and grant NOTHING to anon/authenticated — the app never uses them.
-- Do not copy Supabase's announcement template, which grants anon SELECT and authenticated full CRUD.
-- Every statement is idempotent; the file runs as one transaction.

begin;

-- 1. service_role: the only role the app uses. Already holds these on the live DB (no-op there).
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 2. Finish 0011. MAINTAIN is a Postgres 17 privilege (VACUUM/ANALYZE/REINDEX/LOCK TABLE) that 0011's
--    revoke list predates; anon and authenticated still held it on all 7 tables. Not reachable through
--    PostgREST, but there is no reason for client roles to hold anything.
revoke maintain on all tables in schema public from anon, authenticated;

-- 3. Remove the unused anon read path on drops. 0003 gave anon a 12-column SELECT on public drops,
--    gated by the drops_public_read policy — a design where the /p page read the DB directly with the
--    anon key. The shipped /p page reads through /api/public (service_role) instead, and no code
--    references the anon key. The path still let anyone holding that key enumerate every public safe —
--    including tlock_shard_a, iv and blob_name, enough to decrypt a released one without its link.
--    Since 0011 it has only been failing by accident (drops_owner_rw calls deaddrop_owner(), whose
--    EXECUTE anon lost), so re-granting that EXECUTE would silently have reopened it.
--    Revoking the table-level SELECT also revokes the column-level grants.
drop policy if exists drops_public_read on public.drops;
revoke select on public.drops from anon;

-- 4. Defaults for objects created by this role (postgres): 0011 left SELECT for anon on new tables,
--    plus MAINTAIN for both client roles and full sequence access. Supabase's cutover changes its own
--    defaults; this makes ours explicit regardless of how that lands.
alter default privileges in schema public revoke select, maintain on tables from anon;
alter default privileges in schema public revoke maintain on tables from authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

commit;
