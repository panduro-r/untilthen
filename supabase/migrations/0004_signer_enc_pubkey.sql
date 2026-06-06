-- Multisig signer registration stores the signer's X25519 ENCRYPTION public key (32 bytes), not a
-- BLS pubkey. In the owner-dealt model the signer publishes an enc pubkey so the owner can ECIES the
-- signer's Shamir share to them; the signer's BLS verification pubkey (P_i = s_i·G1) is computed by
-- the owner during dealing and lives on-chain. Rename the column to reflect this.
alter table signer_registrations rename column bls_pubkey to enc_pubkey;
