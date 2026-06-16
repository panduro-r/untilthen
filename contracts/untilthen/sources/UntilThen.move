/// Until Then on-chain module (ARCHITECTURE.md "Aptos / Move integration", CLAUDE.md Step 12).
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
/// Status: COMPILES and PASSES `aptos move test` (4/4) on Aptos CLI 9.4.0 against the mainnet
/// framework. Not yet deployed to testnet — when deploying, set the real address in
/// NEXT_PUBLIC_DEADDROP_CONTRACT_ADDRESS.
///
/// BLS domain-separation tag (DST) — RESOLVED via `crypto_algebra`, verified on-chain:
///   The off-chain signature share is produced with the IBE/drand-compatible DST
///   "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_" (the basic scheme tlock-js uses), because that
///   same share must also aggregate into a valid IBE decryption key (lib/threshold.ts). Aptos's
///   high-level `aptos_std::bls12381` uses the proof-of-possession scheme ("...POP_"), which would
///   NOT accept our share. So we do NOT use it. Instead `verify_share` does the BLS pairing check
///   directly via `aptos_std::crypto_algebra` + `aptos_std::bls12381_algebra`, hashing to G2 with
///   our exact NUL DST — identical to the off-chain check in lib/threshold.ts::verifySignatureShare.
///   This is Until Then's MinPK scheme: pubkeys on G1, signatures on G2, identity hashed to G2.
///
///   The `test_verify_share_matches_offchain_vector` test proves Aptos's RFC 9380 hash-to-G2
///   (HashG2XmdSha256SswuRo) yields the SAME point as noble's hashToCurve: a signature share
///   generated off-chain by scripts/gen-move-vector.mjs (the lib/threshold.ts path) verifies
///   on-chain, while a tampered share and a wrong identity are rejected.
/// ============================================================================================
module until_then::until_then {
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

    /// Module-level registry, published once under @until_then.
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
        assert!(signer::address_of(publisher) == @until_then, error::permission_denied(E_NOT_OWNER));
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
        assert!(exists<Registry>(@until_then), error::unavailable(E_NOT_INITIALIZED));
        let reg = borrow_global_mut<Registry>(@until_then);
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
        let reg = borrow_global_mut<Registry>(@until_then);
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
        let reg = borrow_global_mut<Registry>(@until_then);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        let drop = table::borrow(&reg.drops, id);
        assert!(drop.owner == signer::address_of(caller), error::permission_denied(E_NOT_OWNER));
        event::emit(DropReset { id, new_release_round });
    }

    #[view]
    /// Read release state. The published signature shares are read via `get_sig_shares`.
    public fun is_released(id: vector<u8>): bool acquires Registry {
        let reg = borrow_global<Registry>(@until_then);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        table::borrow(&reg.drops, id).released
    }

    #[view]
    /// Return the published BLS signature shares (aggregate off-chain once released).
    public fun get_sig_shares(id: vector<u8>): vector<vector<u8>> acquires Registry {
        let reg = borrow_global<Registry>(@until_then);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        table::borrow(&reg.drops, id).sig_shares
    }

    #[view]
    public fun get_ibe_header(id: vector<u8>): vector<u8> acquires Registry {
        let reg = borrow_global<Registry>(@until_then);
        assert!(table::contains(&reg.drops, id), error::not_found(E_DROP_MISSING));
        table::borrow(&reg.drops, id).ibe_ciphertext_header
    }

    /// BLS verification of a signature share against a signer's public key over the drop identity.
    ///
    /// Until Then MinPK scheme: pubkey P_i on G1, signature share sig_i on G2, identity hashed to G2
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

    // Multisig vectors over identity "drop_multisig" (3 independent signers), from
    // scripts/gen-move-vector.mjs. On-chain verification is per-signer + a threshold count, so
    // independent keypairs suffice (Shamir aggregation is an off-chain IBE concern, tested in TS).
    #[test_only]
    fun ms_signers(): vector<address> { vector[@0xAA0, @0xAA1, @0xAA2] }
    #[test_only]
    fun ms_pubkeys(): vector<vector<u8>> {
        vector[
            x"aa5f4bc195b0f1118de918e328271b10dbadc59daf87ab13fa8b49f12b72f29b03949aa688da90a4d85736824b3a84d9",
            x"b50e054e6c42cead7269ad1c500da49ca04511b187f76e7e1889252ed0c4e0037103024d59e854a3573d434dc9aa9370",
            x"adf12f6b20f2cc2918356298024e6e895bb11b78f65ef40e3886ad37b08277db9a66f93ee3fe1b4ef89f2456f47bc975",
        ]
    }
    #[test_only]
    const MS_SIG0: vector<u8> = x"a43ac905a8736435bc85ca5f41513b154c48a54745fbabd5774a332c3688400e90ad4a7d4a4796ac80d4439ccbb2a5a00485e9666d98e190a9d75c62df2e0419d212c4a1ab2f57743a6c35a17421cea8b29054cc8312f918a37d5b97437f0ace";
    #[test_only]
    const MS_SIG2: vector<u8> = x"8e2a72678667a25a30e9c87be1a4336c540ea73a97b7a85b33066505f97b8c77840f4899502013357c38ef8c9e5203bd15a87fdf0d50561b9a0ce9df6fe523ebb4a7fe7db0a98ac3bc8547cff8fb0d0b48c0f15eaba3e62413e233cbb9e550c5";

    #[test_only]
    fun new_multisig_drop(framework: &signer, publisher: &signer): vector<u8> acquires Registry {
        timestamp::set_time_has_started_for_testing(framework); // create_drop reads now_seconds()
        init(publisher);
        let id = b"drop_multisig";
        create_drop(
            publisher, id, MODE_MULTISIG, 1 /* public */, 2 /* threshold */,
            ms_signers(), ms_pubkeys(), x"01" /* group_pubkey */,
            vector::empty<vector<u8>>() /* enc_key_shares */, x"01" /* ibe header */,
        );
        id
    }

    #[test(framework = @aptos_framework, publisher = @until_then, s0 = @0xAA0, s2 = @0xAA2)]
    fun test_multisig_threshold_release(framework: signer, publisher: signer, s0: signer, s2: signer) acquires Registry {
        let id = new_multisig_drop(&framework, &publisher);
        assert!(!is_released(id), 1);

        // first approval — below threshold (2)
        approve_release(&s0, id, MS_SIG0);
        assert!(!is_released(id), 2);

        // second approval — threshold met → released, and both shares are now published on-chain
        approve_release(&s2, id, MS_SIG2);
        assert!(is_released(id), 3);
        assert!(vector::length(&get_sig_shares(id)) == 2, 4);
    }

    #[test(framework = @aptos_framework, publisher = @until_then, stranger = @0xBEEF)]
    #[expected_failure(abort_code = 0x50005, location = Self)] // permission_denied(E_NOT_A_SIGNER)
    fun test_reject_non_signer(framework: signer, publisher: signer, stranger: signer) acquires Registry {
        let id = new_multisig_drop(&framework, &publisher);
        approve_release(&stranger, id, MS_SIG0);
    }

    #[test(framework = @aptos_framework, publisher = @until_then, s0 = @0xAA0)]
    #[expected_failure(abort_code = 0x10006, location = Self)] // invalid_argument(E_BAD_SHARE)
    fun test_reject_bad_share(framework: signer, publisher: signer, s0: signer) acquires Registry {
        let id = new_multisig_drop(&framework, &publisher);
        // signer 0 submits signer 2's signature → fails BLS verification against pubkey[0]
        approve_release(&s0, id, MS_SIG2);
    }
}
