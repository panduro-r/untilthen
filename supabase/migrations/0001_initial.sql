-- Until Then initial schema (CLAUDE.md Step 8 / ARCHITECTURE.md "Data model").
--
-- Four tables: drops, recipients, recipient_secrets, signers.
-- There is deliberately NO shard_a / key / secret / plaintext title / plaintext email column.
-- Every secret-derived column is gated (tlock/IBE), wallet-wrapped, or per-recipient wrapped — none
-- usable by the backend. Titles and emails are encrypted at rest (metadata minimization).

create table drops (
  id text primary key,                       -- "drop_xxxx"
  owner_address text not null,
  encrypted_title text not null,             -- client-encrypted under owner key; backend never sees plaintext
  blob_name text not null,
  iv text not null,                          -- base64
  ciphertext_fingerprint text not null,
  mode text not null check (mode in ('timelock','multisig')),
  distribution text not null check (distribution in ('private','public')),

  -- gating — exactly one path is populated. NO raw shard_a / key / secret column exists.
  -- For private drops the gated secret is shardA; for public drops it is K.
  tlock_shard_a text,                        -- timelock mode: drand-locked IBE ciphertext
  release_round bigint,                      -- timelock mode: drand round it unlocks at
  contract_ref text,                         -- multisig mode: on-chain drop reference
  ibe_header text,                           -- multisig mode: IBE ciphertext to identity=dropId

  -- owner reset material (wallet-wrapped; useless to the backend). At most one is set.
  owner_shard_a text,                        -- private drops: shardA XOR owner wrap key
  owner_key_wrapped text,                    -- public drops:  K XOR owner wrap key

  check_in_interval_days int,
  grace_period_days int,
  trigger_at timestamptz,                    -- chosen release time (maps to release_round)
  released_at timestamptz,                   -- set by notifier when condition observed met
  notifications_sent_at timestamptz,
  expiration_micros bigint not null,
  created_at timestamptz default now(),

  -- exactly one gating path present
  constraint drops_gating_check check (
    (mode = 'timelock' and tlock_shard_a is not null and release_round is not null)
    or
    (mode = 'multisig' and ibe_header is not null and contract_ref is not null)
  )
);

create table recipients (
  id text primary key,                       -- "rcpt_xxxx" (private drops only)
  drop_id text not null references drops(id) on delete cascade,
  name text,
  type text not null check (type in ('email','wallet')),
  encrypted_email text not null,             -- decryptable only by the notifier (EMAIL_ENC_KEY)
  encrypted_backup_email text,               -- optional, same treatment
  wallet_address text,
  wallet_chain text check (wallet_chain in ('aptos','solana','ethereum')),
  wrapped_shard_b text not null,             -- base64
  released_at timestamptz                    -- set when this recipient's link is burned
);

create table recipient_secrets (
  recipient_id text primary key references recipients(id) on delete cascade,
  secret text not null,                      -- base64 — deleted the moment notification is sent
  created_at timestamptz default now()
);

-- Multisig drops only: the designated signers who must approve release.
create table signers (
  id text primary key,                       -- "sgnr_xxxx"
  drop_id text not null references drops(id) on delete cascade,
  name text,
  wallet_address text not null,
  wallet_chain text not null check (wallet_chain in ('aptos','solana','ethereum')),
  bls_pubkey text,                           -- base64 — set at registration; verifies approvals
  encrypted_email text not null,             -- approval-request notification; encrypted at rest
  registered boolean not null default false, -- owner cannot arm until all are registered
  approved_at timestamptz                    -- cached from chain for dashboard display
);

-- Pre-registration storage (written BEFORE the drop is armed, so these intentionally have no FK to
-- drops). The owner reads them server-side to assemble wrappedShardB / the signer group, then the
-- final recipients/signers rows are created at arm time. All access is server-side (service role).
create table wallet_registrations (
  drop_id text not null,
  recipient_id text not null,
  wallet_address text not null,
  wallet_chain text not null check (wallet_chain in ('aptos','solana','ethereum')),
  signature text not null,
  public_key text,
  created_at timestamptz default now(),
  primary key (drop_id, recipient_id)
);

create table signer_registrations (
  drop_id text not null,
  signer_id text not null,
  wallet_address text not null,
  wallet_chain text not null check (wallet_chain in ('aptos','solana','ethereum')),
  bls_pubkey text not null,
  created_at timestamptz default now(),
  primary key (drop_id, signer_id)
);

create index drops_release_pending on drops (release_round) where released_at is null and mode = 'timelock';
create index drops_owner on drops (owner_address);
create index recipients_drop on recipients (drop_id);
create index signers_drop on signers (drop_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security. Owner identity comes from a custom JWT claim
-- (request.jwt.claims ->> 'owner_address'), set when the owner authenticates with a wallet
-- challenge. The service role (notifier / API routes) bypasses RLS.
-- ---------------------------------------------------------------------------

alter table drops enable row level security;
alter table recipients enable row level security;
alter table recipient_secrets enable row level security;
alter table signers enable row level security;
-- Registration tables: NO client access (service role only). RLS on + no policy = deny all.
alter table wallet_registrations enable row level security;
alter table signer_registrations enable row level security;

create or replace function deaddrop_owner() returns text
  language sql stable as $$ select current_setting('request.jwt.claims', true)::json ->> 'owner_address' $$;

-- drops: owner reads/updates their own; anyone may read PUBLIC drops (the /p page needs the gated
-- columns — safe because the drand/contract gate protects the content).
create policy drops_owner_rw on drops
  for all using (owner_address = deaddrop_owner()) with check (owner_address = deaddrop_owner());
create policy drops_public_read on drops
  for select using (distribution = 'public');

-- recipients: only the parent drop's owner. No anonymous access (retrieval goes via /api/retrieve).
create policy recipients_owner_rw on recipients
  for all using (exists (select 1 from drops d where d.id = recipients.drop_id and d.owner_address = deaddrop_owner()))
  with check (exists (select 1 from drops d where d.id = recipients.drop_id and d.owner_address = deaddrop_owner()));

-- recipient_secrets: NO client access at all (service role only).
-- (RLS enabled with no policy => deny all for anon/authenticated.)

-- signers: the parent drop's owner manages them; signer self-registration goes through the
-- server-side /api/register-signer route (service role), not direct client writes.
create policy signers_owner_rw on signers
  for all using (exists (select 1 from drops d where d.id = signers.drop_id and d.owner_address = deaddrop_owner()))
  with check (exists (select 1 from drops d where d.id = signers.drop_id and d.owner_address = deaddrop_owner()));
