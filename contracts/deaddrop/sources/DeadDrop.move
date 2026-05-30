/// DeadDrop on-chain module (ARCHITECTURE.md "Aptos / Move integration", CLAUDE.md Step 12).
///
/// Two jobs:
///   1. On-chain audit anchor for ALL drops (id, owner, mode, timestamps, reset events).
///   2. Threshold-gated release for MULTISIG drops, using the SAME threshold-BLS/IBE primitive as
///      timelock. The secret is IBE-encrypted off-chain to identity = dropId under the signer
///      group's BLS public key. A signer "approves" by publishing a BLS signature share over the
///      dropId; once `threshold` valid shares exist, anyone aggregates them off-chain into the IBE
///      decryption key. Nothing decryptable is ever on-chain: the IBE header needs the identity key,
///      and sub-threshold signature shares reveal nothing.
///
/// ============================================================================================
/// ⚠ NOT YET COMPILED — no Aptos toolchain in the dev env. Run `aptos move compile` +
/// `aptos move test` before deploying. The BLS-DST item below is RESOLVED in code; the one
/// remaining check is a cross-implementation test vector (see `verify_share`).
///
/// BLS domain-separation tag (DST) — RESOLVED via `crypto_algebra` (option b):
///   The off-chain signature share is produced with the IBE/drand-compatible DST
///   "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_" (the basic scheme tlock-js uses), because that
///   same share must also aggregate into a valid IBE decryption key (lib/threshold.ts). Aptos's
///   high-level `aptos_std::bls12381` uses the proof-of-possession scheme ("...POP_"), which would
///   NOT accept our share. So we do NOT use it. Instead `verify_share` does the BLS pairing check
///   directly via `aptos_std::crypto_algebra` + `aptos_std::bls12381_algebra`, hashing to G2 with
///   our exact NUL DST — identical to the off-chain check in lib/threshold.ts::verifySignatureShare.
///   This is DeadDrop's MinPK scheme: pubkeys on G1, signatures on G2, identity hashed to G2.
///
///   Remaining task before deploy: confirm with a test vector that Aptos's RFC 9380 hash-to-G2
///   (HashG2XmdSha256SswuRo) yields the SAME point as noble's hashToCurve for an identical
///   (DST, message) pair. They both implement BLS12381G2_XMD:SHA-256_SSWU_RO_, so this is expected,
///   but it must be asserted on-chain against a noble-generated vector in `aptos move test`.
/// ============================================================================================
module deaddrop::dead_drop {
    use std::signer;
    use std::vector;
    use std::error;
    use std::option;
    use aptos_std::table::{Self, Table};
    use aptos_std::crypto_algebra::{eq, pairing, one, deserialize, hash_to};
    use aptos_std::bls12381_algebra::{G1, G2, Gt, FormatG1Compr, FormatG2Compr, HashG2XmdSha256SswuRo};
    use aptos_framework::timestamp;
    use aptos_framework::event;

    const MODE_TIMELOCK: u8 = 0;
    const MODE_MULTISIG: u8 = 1;

    /// Identity = IDENTITY_PREFIX || dropId, hashed to G2 (must match lib/threshold.ts identityBytes).
    const IDENTITY_PREFIX: vector<u8> = b"deaddrop:approve:";
    /// DST for hash-to-G2 — must match lib/threshold.ts IDENTITY_DST and tlock-js's IBE.
    const IDENTITY_DST: vector<u8> = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_";

    /// Errors
    const E_NOT_INITIALIZED: u64 = 1;
    const E_DROP_EXISTS: u64 = 2;
    const E_DROP_MISSING: u64 = 3;
    const E_NOT_MULTISIG: u64 = 4;
    const E_NOT_A_SIGNER: u64 = 5;
    const E_BAD_SHARE: u64 = 6;
    const E_ALREADY_APPROVED: u64 = 7;
    const E_NOT_OWNER: u64 = 8;

    struct Drop has store {
        id: vector<u8>,
        owner: address,
        mode: u8,
        distribution: u8,
        created_at: u64,

        // multisig only:
        threshold: u8,
        signers: vector<address>,
        signer_bls_pubkeys: vector<vector<u8>>,  // each signer's BLS public key (G1, from registration)
        group_pubkey: vector<u8>,                // group BLS public key (IBE authority)
        enc_key_shares: vector<vector<u8>>,      // each signer's BLS secret-key share, encrypted to them
        ibe_ciphertext_header: vector<u8>,       // IBE encryption of the secret to identity = id
        sig_shares: vector<vector<u8>>,          // BLS signature shares over id, filled as signers approve
        approvals: vector<address>,
        released: bool,                          // true once |approvals| >= threshold
    }

    /// Module-level registry, published once under @deaddrop.
    struct Registry has key {
        drops: Table<vector<u8>, Drop>,
    }

    #[event]
    struct DropCreated has drop, store { id: vector<u8>, owner: address, mode: u8 }
    #[event]
    struct DropApproved has drop, store { id: vector<u8>, signer: address, approvals: u64 }
    #[event]
    struct DropReleased has drop, store { id: vector<u8> }
    #[event]
    struct DropReset has drop, store { id: vector<u8>, new_release_round: u64 }

    /// Publish the registry. Called once by the module account.
    public entry fun init(publisher: &signer) {
        assert!(signer::address_of(publisher) == @deaddrop, error::permission_denied(E_NOT_OWNER));
        move_to(publisher, Registry { drops: table::new() });
    }

    /// Register a drop (audit anchor). For multisig, also stores the group key, per-signer BLS
    /// pubkeys, encrypted key shares, and the IBE ciphertext header.
    public entry fun create_drop(
        owner: &signer,
        id: vector<u8>,
        mode: u8,
        distribution: u8,
        threshold: u8,
        signers: vector<address>,
        signer_bls_pubkeys: vector<vector<u8>>,
        group_pubkey: vector<u8>,
        enc_key_shares: vector<vector<u8>>,
        ibe_ciphertext_header: vector<u8>,
    ) acquires Registry {
        assert!(exists<Registry>(@deaddrop), error::unavailable(E_NOT_INITIALIZED));
        let reg = borrow_global_mut<Registry>(@deaddrop);
        assert!(!table::contains(&reg.drops, id), error::already_exists(E_DROP_EXISTS));

        let drop = Drop {
            id,
            owner: signer::address_of(owner),
            mode,
            distribution,
            created_at: timestamp::now_seconds(),
            threshold,
            signers,
            signer_bls_pubkeys,
            group_pubkey,
            enc_key_shares,
            ibe_ciphertext_header,
            sig_shares: vector::empty(),
            approvals: vector::empty(),
            released: false,
        };
        event::emit(DropCreated { id, owner: signer::address_of(owner), mode });
        table::add(&mut reg.drops, id, drop);
    }

    /// Multisig: a signer publishes a BLS signature share over `id`. The contract verifies it against
    /// the signer's registered BLS public key, records it, and flips `released` at threshold.
    public entry fun approve_release(
        caller: &signer,
        id: vector<u8>,
        sig_share: vector<u8>,
    ) acquires Registry {
        let reg = borrow_global_mut<Registry>(@deaddrop);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        let drop = table::borrow_mut(&mut reg.drops, id);
        assert!(drop.mode == MODE_MULTISIG, error::invalid_state(E_NOT_MULTISIG));

        let who = signer::address_of(caller);
        let (is_signer, idx) = index_of(&drop.signers, who);
        assert!(is_signer, error::permission_denied(E_NOT_A_SIGNER));
        assert!(!contains_addr(&drop.approvals, who), error::already_exists(E_ALREADY_APPROVED));

        let pubkey = *vector::borrow(&drop.signer_bls_pubkeys, idx);
        assert!(verify_share(&sig_share, &pubkey, &drop.id), error::invalid_argument(E_BAD_SHARE));

        vector::push_back(&mut drop.approvals, who);
        vector::push_back(&mut drop.sig_shares, sig_share);
        event::emit(DropApproved { id, signer: who, approvals: vector::length(&drop.approvals) });

        if ((vector::length(&drop.approvals) as u8) >= drop.threshold && !drop.released) {
            drop.released = true;
            event::emit(DropReleased { id });
        }
    }

    /// Timelock drops record reset events for the audit trail (no secret material on-chain).
    public entry fun record_reset(caller: &signer, id: vector<u8>, new_release_round: u64)
    acquires Registry {
        let reg = borrow_global_mut<Registry>(@deaddrop);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        let drop = table::borrow(&reg.drops, id);
        assert!(drop.owner == signer::address_of(caller), error::permission_denied(E_NOT_OWNER));
        event::emit(DropReset { id, new_release_round });
    }

    #[view]
    /// Read release state. The published signature shares are read via `get_sig_shares`.
    public fun is_released(id: vector<u8>): bool acquires Registry {
        let reg = borrow_global<Registry>(@deaddrop);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        table::borrow(&reg.drops, id).released
    }

    #[view]
    /// Return the published BLS signature shares (aggregate off-chain once released).
    public fun get_sig_shares(id: vector<u8>): vector<vector<u8>> acquires Registry {
        let reg = borrow_global<Registry>(@deaddrop);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        table::borrow(&reg.drops, id).sig_shares
    }

    #[view]
    public fun get_ibe_header(id: vector<u8>): vector<u8> acquires Registry {
        let reg = borrow_global<Registry>(@deaddrop);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        table::borrow(&reg.drops, id).ibe_ciphertext_header
    }

    /// BLS verification of a signature share against a signer's public key over the drop identity.
    ///
    /// DeadDrop MinPK scheme: pubkey P_i on G1, signature share sig_i on G2, identity hashed to G2
    /// with the NUL DST. Checks the pairing equation  e(P_i, Q) == e(g1, sig_i)  where
    /// Q = hash_to_G2(IDENTITY_PREFIX || id). This is byte-for-byte the same check as the off-chain
    /// lib/threshold.ts::verifySignatureShare, and the same Q that the IBE was encrypted under, so a
    /// share that verifies here also aggregates into the IBE decryption key. Malformed points are
    /// rejected (deserialize returns none) rather than aborting.
    fun verify_share(sig_share: &vector<u8>, pubkey: &vector<u8>, id: &vector<u8>): bool {
        let pk_opt = deserialize<G1, FormatG1Compr>(pubkey);
        if (!option::is_some(&pk_opt)) return false;
        let sig_opt = deserialize<G2, FormatG2Compr>(sig_share);
        if (!option::is_some(&sig_opt)) return false;

        let pk = option::extract(&mut pk_opt);
        let sig = option::extract(&mut sig_opt);

        // message = IDENTITY_PREFIX || id  (must match lib/threshold.ts identityBytes)
        let message = IDENTITY_PREFIX;
        vector::append(&mut message, *id);
        let q = hash_to<G2, HashG2XmdSha256SswuRo>(&IDENTITY_DST, &message);

        // e(P_i, Q) == e(g1_generator, sig_i)
        eq(
            &pairing<G1, G2, Gt>(&pk, &q),
            &pairing<G1, G2, Gt>(&one<G1>(), &sig),
        )
    }

    fun index_of(addrs: &vector<address>, who: address): (bool, u64) {
        let i = 0;
        let n = vector::length(addrs);
        while (i < n) {
            if (*vector::borrow(addrs, i) == who) return (true, i);
            i = i + 1;
        };
        (false, 0)
    }

    fun contains_addr(addrs: &vector<address>, who: address): bool {
        let (found, _) = index_of(addrs, who);
        found
    }

    // ----------------------------------------------------------------------------------------
    // Tests (run with `aptos move test`). The vector below was generated by the SAME off-chain
    // code path (noble BLS12-381, NUL DST, "deaddrop:approve:" identity prefix) used in
    // lib/threshold.ts — see scripts/gen-move-vector.mjs. It asserts that Aptos's RFC 9380
    // hash-to-G2 agrees with noble's, i.e. that an off-chain-produced share verifies on-chain.
    //
    // Deterministic 1-of-1 group: s fixed, pubkey = s·G1, sig = s·hash_to_G2("deaddrop:approve:" ||
    // "drop_testvec").
    #[test]
    fun test_verify_share_matches_offchain_vector() {
        let pubkey = x"862dbccffc20b36ba1b3cf6f6b580c28e955bd5d94ef93775d9e74e6f76e20d9f4d1bf023483c3dd64cbed78323c2c7e";
        let sig = x"a65d5fd8143876a13baa6ecb849a9c5572918d25a64d8b95120ff6c7b0509c0848c100162c91a622303674b3dfb2318411049589a5b8710bb98aaa30231a5bf3d572e8eb8770b8a73b8ed45cb6221e834978d87243897162d93e1fd481568556";
        let id = b"drop_testvec";
        assert!(verify_share(&sig, &pubkey, &id), 100);

        // Tamper one byte of the signature -> must fail the pairing check.
        let bad = sig;
        let b0 = *vector::borrow(&bad, 0);
        *vector::borrow_mut(&mut bad, 0) = b0 ^ 1u8;
        assert!(!verify_share(&bad, &pubkey, &id), 101);

        // Wrong identity -> must fail (the share is bound to "drop_testvec").
        let other = b"drop_other";
        assert!(!verify_share(&sig, &pubkey, &other), 102);
    }
}
