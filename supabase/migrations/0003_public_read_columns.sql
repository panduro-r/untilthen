-- Security fix (review finding): the original `drops_public_read` policy granted anon SELECT on
-- EVERY column of any public-distribution drop, so a direct PostgREST query with the public anon key
-- (`/rest/v1/drops?distribution=eq.public&select=*`) could read owner_address, encrypted_title, and
-- the owner's wallet-wrapped reset copy (owner_shard_a/owner_key_wrapped) — bypassing the safe-subset
-- /api/public route. Postgres RLS can't restrict columns, so we combine an anon-scoped row policy
-- with column-level GRANTs: anon may project ONLY the columns the /p page needs.

-- Re-scope the public read to the anon role (owners read their own rows via drops_owner_rw).
drop policy if exists drops_public_read on drops;
create policy drops_public_read on drops
  for select to anon
  using (distribution = 'public');

-- Column-level privilege: anon may SELECT only these columns. With table-level SELECT revoked,
-- `select=*` (which expands to all columns) is denied, and the sensitive columns
-- (owner_address, encrypted_title, owner_shard_a, owner_key_wrapped, *_days, expiration_micros,
--  notifications_sent_at, created_at) are not readable by anon at all.
revoke select on drops from anon;
grant select (
  id, mode, distribution, release_round, contract_ref, tlock_shard_a, ibe_header,
  iv, blob_name, ciphertext_fingerprint, trigger_at, released_at
) on drops to anon;

-- Defense-in-depth: the sensitive sibling tables are already RLS deny-all for anon (no permissive
-- policy), but "automatically expose new tables" granted anon table privileges, so revoke them too.
revoke select on recipients from anon;
revoke select on recipient_secrets from anon;
revoke select on signers from anon;
revoke select on wallet_registrations from anon;
revoke select on signer_registrations from anon;
