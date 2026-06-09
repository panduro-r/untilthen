-- Wallet-paid Shelby: blobs are namespaced by the OWNER's wallet address, so the private retrieval
-- response must include it for the recipient's browser to locate the blob. Add owner_address to the
-- atomic burn_recipient RETURNING. (Same single UPDATE ... RETURNING — still one atomic op.)

-- Return-type change requires a drop (Postgres can't CREATE OR REPLACE a new RETURNS TABLE shape).
drop function if exists burn_recipient(text, text, bigint);

create or replace function burn_recipient(
  p_drop_id text,
  p_recipient_id text,
  p_expiry_ms bigint
) returns table (
  wrapped_shard_b text,
  tlock_shard_a text,
  contract_ref text,
  ibe_header text,
  release_round bigint,
  iv text,
  blob_name text,
  ciphertext_fingerprint text,
  mode text,
  owner_address text
)
language sql
as $$
  update recipients r set released_at = now()
  from drops d
  where r.id = p_recipient_id
    and r.drop_id = p_drop_id
    and d.id = r.drop_id
    and r.released_at is null
    and d.distribution = 'private'
    and d.released_at is not null
    and d.released_at + (p_expiry_ms || ' milliseconds')::interval > now()
  returning r.wrapped_shard_b, d.tlock_shard_a, d.contract_ref, d.ibe_header, d.release_round,
            d.iv, d.blob_name, d.ciphertext_fingerprint, d.mode, d.owner_address;
$$;
