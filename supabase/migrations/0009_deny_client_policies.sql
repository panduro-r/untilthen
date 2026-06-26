-- Explicit deny-all policies on server-only tables (Supabase advisory: rls_enabled_no_policy).
-- These four tables are written/read ONLY by the service-role client (lib/db.supabase.ts), which
-- bypasses RLS. They must never be reachable via the anon/authenticated (browser) roles —
-- recipient_secrets in particular holds the per-recipient unwrap secret. RLS-on-with-no-policy is
-- already deny-all, so this is a no-op functionally; the explicit `using (false)` policy documents
-- the intent in the schema and clears the rls_enabled_no_policy advisory. The service role is
-- unaffected (it ignores RLS entirely).

create policy recipient_secrets_deny_client on recipient_secrets
  for all to anon, authenticated using (false) with check (false);

create policy signer_keys_deny_client on signer_keys
  for all to anon, authenticated using (false) with check (false);

create policy signer_registrations_deny_client on signer_registrations
  for all to anon, authenticated using (false) with check (false);

create policy wallet_registrations_deny_client on wallet_registrations
  for all to anon, authenticated using (false) with check (false);
