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
/// ⚠ UNVERIFIED — this module has NOT been compiled or tested (no Aptos toolchain in this env).
/// Run `aptos move compile` + `aptos move test` and resolve the items below before deploying.
///
/// CRITICAL OPEN ITEM — BLS domain-separation tag (DST):
///   The off-chain signature share is produced with the IBE/drand-compatible DST
///   "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_" (the basic scheme tlock-js uses), because that
///   same share must aggregate into a valid IBE decryption key (see lib/threshold.ts). Aptos's
///   `aptos_std::bls12381` native verifiers use the proof-of-possession scheme ("...POP_"). These
///   DSTs differ, so the native verifier may NOT accept our share as-is. Resolve by ONE of:
///     (a) confirm an Aptos native verifier that uses the basic ("NUL") DST over hash-to-G2; or
///     (b) verify the share via a custom pairing check using `aptos_std::crypto_algebra` +
///         `aptos_std::bls12381_algebra` with the exact NUL DST (preferred — keeps one DST); or
///     (c) have signers additionally submit a PoP-DST signature for on-chain gating while the
///         NUL-DST share is used only off-chain for IBE (two sigs; least desirable).
///   Until resolved, on-chain `verify_share` is a placeholder that MUST be made real.
/// ============================================================================================
module deaddrop::dead_drop {
    use std::signer;
    use std::vector;
    use std::error;
    use aptos_std::table::{Self, Table};
    use aptos_framework::timestamp;
    use aptos_framework::event;

    const MODE_TIMELOCK: u8 = 0;
    const MODE_MULTISIG: u8 = 1;

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

    /// BLS verification of a signature share against a signer's public key over the drop id.
    ///
    /// ⚠ PLACEHOLDER — see the DST open item in the module header. The off-chain share uses the
    /// basic "NUL" DST (IBE-compatible); confirm/implement matching verification (option (b):
    /// pairing check via aptos_std::bls12381_algebra with the NUL DST) before deploying. Returning
    /// the share length check below is NOT real verification.
    fun verify_share(sig_share: &vector<u8>, _pubkey: &vector<u8>, _message: &vector<u8>): bool {
        vector::length(sig_share) == 96 // compressed G2 length; replace with a real pairing check
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
}
