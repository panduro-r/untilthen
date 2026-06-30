-- Tag each drop with the network it lives on (Aptos/Shelby network: shelbynet|testnet|mainnet|devnet).
-- The app now follows the wallet's network, so a single deployment stores drops across networks; server
-- release/retrieve must target each drop's own network. Existing rows are all Shelbynet → default it.
alter table drops add column if not exists network text not null default 'shelbynet';
alter table drops add constraint drops_network_check check (network in ('shelbynet', 'testnet', 'mainnet', 'devnet'));

-- Recreate create_drop_tx to persist the new column. Reproduced from the 0008 definition (empty
-- search_path + public.-qualified tables) — only the network column/value are added.
create or replace function create_drop_tx(
  p_drop jsonb,
  p_recipients jsonb,
  p_secrets jsonb,
  p_signers jsonb
) returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.drops (
    id, owner_address, network, encrypted_title, blob_name, iv, ciphertext_fingerprint, mode,
    distribution, tlock_shard_a, release_round, contract_ref, ibe_header, owner_shard_a,
    owner_key_wrapped, check_in_interval_days, grace_period_days, trigger_at, expiration_micros
  )
  select
    p_drop->>'id', p_drop->>'owner_address', coalesce(p_drop->>'network', 'shelbynet'),
    p_drop->>'encrypted_title', p_drop->>'blob_name', p_drop->>'iv', p_drop->>'ciphertext_fingerprint',
    p_drop->>'mode', p_drop->>'distribution', p_drop->>'tlock_shard_a',
    (p_drop->>'release_round')::bigint, p_drop->>'contract_ref', p_drop->>'ibe_header',
    p_drop->>'owner_shard_a', p_drop->>'owner_key_wrapped',
    (p_drop->>'check_in_interval_days')::int, (p_drop->>'grace_period_days')::int,
    case when p_drop->>'trigger_at' is null then null
         else to_timestamp((p_drop->>'trigger_at')::bigint / 1000.0) end,
    (p_drop->>'expiration_micros')::bigint;

  insert into public.recipients (id, drop_id, name, type, encrypted_email, encrypted_backup_email,
                          wallet_address, wallet_chain, wrapped_shard_b)
  select x->>'id', x->>'drop_id', x->>'name', x->>'type', x->>'encrypted_email',
         x->>'encrypted_backup_email', x->>'wallet_address', x->>'wallet_chain', x->>'wrapped_shard_b'
  from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as x;

  insert into public.recipient_secrets (recipient_id, secret)
  select x->>'recipient_id', x->>'secret'
  from jsonb_array_elements(coalesce(p_secrets, '[]'::jsonb)) as x;

  insert into public.signers (id, drop_id, name, wallet_address, wallet_chain, bls_pubkey,
                       encrypted_email, registered)
  select x->>'id', x->>'drop_id', x->>'name', x->>'wallet_address', x->>'wallet_chain',
         x->>'bls_pubkey', x->>'encrypted_email', (x->>'registered')::boolean
  from jsonb_array_elements(coalesce(p_signers, '[]'::jsonb)) as x;
end;
$$;
