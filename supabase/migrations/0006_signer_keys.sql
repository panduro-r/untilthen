-- Once-per-wallet signer keys. Previously each signer published a per-safe X25519 enc pubkey
-- (signer_registrations, keyed by drop_id + signer_id), which forced them to re-register for every
-- safe. A signer's enc key is now derived from a fixed, wallet-scoped message, so it is stable across
-- all safes: store it once per wallet address, and arming looks it up by the owner-designated address.
-- (signer_registrations is left in place but is no longer written by the app.)
create table if not exists signer_keys (
  address text primary key,
  enc_public_key text not null,
  created_at timestamptz not null default now()
);
