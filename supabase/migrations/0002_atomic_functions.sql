-- Atomic RPC functions. supabase-js cannot express the multi-table check-and-burn or the
-- optimistic-concurrency reset as a single query through the query builder, so they live here as
-- SQL functions called via `.rpc(...)`. Each function IS the atomic statement — the single-use,
-- concurrency, and idempotency guarantees from CLAUDE.md hold at the database, not in app code.
--
-- These run via the service-role client (bypasses RLS). They are intentionally NOT granted to anon.

-- Create a drop + its recipients/secrets/signers atomically (all-or-nothing).
create or replace function create_drop_tx(
  p_drop jsonb,
  p_recipients jsonb,
  p_secrets jsonb,
  p_signers jsonb
) returns void
language plpgsql
as $$
begin
  insert into drops (
    id, owner_address, encrypted_title, blob_name, iv, ciphertext_fingerprint, mode, distribution,
    tlock_shard_a, release_round, contract_ref, ibe_header, owner_shard_a, owner_key_wrapped,
    check_in_interval_days, grace_period_days, trigger_at, expiration_micros
  )
  select
    p_drop->>'id', p_drop->>'owner_address', p_drop->>'encrypted_title', p_drop->>'blob_name',
    p_drop->>'iv', p_drop->>'ciphertext_fingerprint', p_drop->>'mode', p_drop->>'distribution',
    p_drop->>'tlock_shard_a', (p_drop->>'release_round')::bigint, p_drop->>'contract_ref',
    p_drop->>'ibe_header', p_drop->>'owner_shard_a', p_drop->>'owner_key_wrapped',
    (p_drop->>'check_in_interval_days')::int, (p_drop->>'grace_period_days')::int,
    case when p_drop->>'trigger_at' is null then null
         else to_timestamp((p_drop->>'trigger_at')::bigint / 1000.0) end,
    (p_drop->>'expiration_micros')::bigint;

  insert into recipients (id, drop_id, name, type, encrypted_email, encrypted_backup_email,
                          wallet_address, wallet_chain, wrapped_shard_b)
  select x->>'id', x->>'drop_id', x->>'name', x->>'type', x->>'encrypted_email',
         x->>'encrypted_backup_email', x->>'wallet_address', x->>'wallet_chain', x->>'wrapped_shard_b'
  from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as x;

  insert into recipient_secrets (recipient_id, secret)
  select x->>'recipient_id', x->>'secret'
  from jsonb_array_elements(coalesce(p_secrets, '[]'::jsonb)) as x;

  insert into signers (id, drop_id, name, wallet_address, wallet_chain, bls_pubkey,
                       encrypted_email, registered)
  select x->>'id', x->>'drop_id', x->>'name', x->>'wallet_address', x->>'wallet_chain',
         x->>'bls_pubkey', x->>'encrypted_email', (x->>'registered')::boolean
  from jsonb_array_elements(coalesce(p_signers, '[]'::jsonb)) as x;
end;
$$;

-- Atomic check-and-burn for private retrieval. Returns one row of locked material, or zero rows if
-- not retrievable (already burned / expired / not released / wrong distribution / nonexistent).
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
  mode text
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
            d.iv, d.blob_name, d.ciphertext_fingerprint, d.mode;
$$;

-- Atomic timelock reset with optimistic-concurrency guard. Returns true iff a row was updated.
create or replace function reset_timelock(
  p_drop_id text,
  p_tlock text,
  p_round bigint,
  p_trigger_ms bigint,
  p_expected_old_round bigint
) returns boolean
language plpgsql
as $$
declare updated int;
begin
  update drops
  set tlock_shard_a = p_tlock,
      release_round = p_round,
      trigger_at = to_timestamp(p_trigger_ms / 1000.0)
  where id = p_drop_id
    and release_round = p_expected_old_round
    and released_at is null;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

-- Atomic, idempotent release stamp. Returns the row ONLY for the caller that set released_at.
create or replace function mark_released(p_drop_id text)
returns setof drops
language sql
as $$
  update drops set released_at = now()
  where id = p_drop_id and released_at is null
  returning *;
$$;
