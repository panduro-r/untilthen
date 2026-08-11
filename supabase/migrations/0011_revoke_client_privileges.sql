-- Security review follow-up: drop the client-role privileges the app never uses.
--
-- The app reaches Postgres ONLY through the service-role client (lib/db.supabase.ts), which bypasses
-- RLS and holds its own explicit grants — so nothing here affects the running app.
--
-- Why it matters: 0003 revoked SELECT from anon on the sensitive tables but left the write privileges
-- and function EXECUTE that Supabase's "auto-expose new tables" default grants. Live state before this
-- migration: anon/authenticated held INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on all 7 tables
-- and EXECUTE on all 5 RPCs, reachable via PostgREST with the *public* anon key. Every one of those
-- was blocked, but by exactly two properties: the functions are SECURITY INVOKER (so their statements
-- hit RLS as the caller) and deaddrop_owner() returns NULL for an anon JWT. Adding SECURITY DEFINER to
-- any of these functions — the usual reflex when an RPC "doesn't work" under RLS — would instantly
-- turn the public anon key into an authenticated writer (e.g. rpc/mark_released to force a release).
-- TRUNCATE is worse in kind: RLS covers SELECT/INSERT/UPDATE/DELETE only, so RLS is not a backstop for
-- it at all (it isn't reachable through PostgREST today, so it was latent rather than live).
--
-- Removing the privileges removes the whole class, instead of depending on SECURITY INVOKER surviving
-- every future edit.

-- 1. Writes: no client role ever writes; the service role does.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;

-- 2. RPCs: called only by the service-role client. Revoke from PUBLIC too — that's the default grant
--    every function gets. service_role keeps its own explicit EXECUTE grant and is unaffected.
revoke execute on all functions in schema public from public, anon, authenticated;

-- 3. Reads. 0003 revoked SELECT from `anon` only — `authenticated` kept full-table SELECT on
--    everything, including recipient_secrets (the one-time retrieval secrets) and every column of
--    drops (owner_shard_a, encrypted_title — broader than the column subset anon was deliberately
--    given). signer_keys, added in 0006 after those revokes, still had anon SELECT as well. RLS denies
--    all of it, but the app has no Supabase-Auth users and never reads as a client role, so the grants
--    are pure latent surface. The deliberate column-level anon SELECT on `drops` from 0003 stays.
revoke select on signer_keys from anon, authenticated;
revoke select on drops, recipients, recipient_secrets, signers,
                 wallet_registrations, signer_registrations
  from authenticated;

-- 4. Stop the drift from recurring: new tables/functions in this schema shouldn't hand client roles
--    privileges by default. (Only affects objects created by the role running this migration; a no-op
--    otherwise, which is harmless.)
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public
  revoke select on tables from authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- All statements above are idempotent (REVOKE of an absent privilege is a no-op), so re-running this
-- file is safe.
