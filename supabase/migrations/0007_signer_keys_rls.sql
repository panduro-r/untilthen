-- Enable RLS on signer_keys (Supabase advisory: rls_disabled_in_public).
-- 0006 created this table without RLS, leaving it readable/writable by anyone holding the project's
-- anon key. All app access goes through the service-role client (lib/db.supabase.ts), which bypasses
-- RLS, so enabling RLS with no policy closes the public hole without affecting the app. enc_public_key
-- is a public X25519 key, but there is no code path that needs anon/public access to this table.
alter table signer_keys enable row level security;
