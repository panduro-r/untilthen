// lib/contract.ts — Aptos/Move integration entrypoint for multisig drops + the audit anchor.
//
// The client-side threshold BLS/IBE crypto lives in lib/threshold.ts (reusing tlock-js's audited
// IBE). This module is the orchestration layer the pages call: it re-exports that crypto and adds
// the on-chain interactions (MoveContractClient). The real client (Aptos ts-sdk) is wired when the
// wallet adapter is mounted; until then MockMoveContractClient backs everything in memory and runs
// the SAME BLS verification the Move contract will (contracts/deaddrop/sources/DeadDrop.move).
//
// See ARCHITECTURE.md "Aptos / Move integration": nothing decryptable is ever on-chain — the IBE
// header needs the identity key, and sub-threshold signature shares reveal nothing.

import {
  setupSignerGroup,
  ibeEncryptToGroup,
  produceSignatureShare,
  verifySignatureShare,
  ibeDecryptWithShares,
  type SignatureShare,
  type GroupSetup,
  type SignerKeyMaterial,
} from "./threshold"
import type { DropDistribution, DropMode } from "@/types"

export type { SignatureShare, GroupSetup, SignerKeyMaterial }
export {
  setupSignerGroup,
  ibeEncryptToGroup,
  produceSignatureShare,
  verifySignatureShare,
  ibeDecryptWithShares,
}

/** The on-chain drop record — mirror of the Move `Drop` struct. All fields are public-safe. */
export type ChainDrop = {
  dropId: string
  owner: string
  mode: DropMode
  distribution: DropDistribution
  threshold: number
  signers: string[] // signer Aptos addresses
  signerBlsPubkeys: string[] // parallel to `signers`; base64 compressed G1
  groupPubkey: string // base64 compressed G1 (IBE master)
  encKeyShares: string[] // each signer's BLS secret-key share, encrypted to them
  ibeHeader: string // IBE ciphertext of the secret to identity=dropId
  sigShares: SignatureShare[] // filled as signers approve
  approvals: string[] // signer addresses that have approved
  released: boolean // true once approvals >= threshold
}

export type CreateDropArgs = {
  dropId: string
  owner: string
  mode: DropMode
  distribution: DropDistribution
  // multisig only:
  threshold?: number
  signers?: string[]
  signerBlsPubkeys?: string[]
  groupPubkey?: string
  encKeyShares?: string[]
  ibeHeader?: string
}

export interface MoveContractClient {
  /** Register a drop (audit anchor; for multisig also stores group key + IBE header). */
  createDrop(args: CreateDropArgs): Promise<{ contractRef: string }>
  /** Publish a BLS signature share; the contract BLS-verifies it and flips `released` at threshold. */
  approveRelease(dropId: string, signerAddress: string, share: SignatureShare): Promise<void>
  /** Read release state + the published signature shares (aggregate off-chain once released). */
  getReleaseMaterial(dropId: string): Promise<{ released: boolean; sigShares: SignatureShare[] }>
  /** Record a timelock reset for the audit trail (no secret material on-chain). */
  recordReset(dropId: string, newReleaseRound: number): Promise<void>
  getDrop(dropId: string): Promise<ChainDrop | null>
}

/**
 * In-memory MoveContractClient mirroring the Move contract's behavior, including BLS verification of
 * approval shares. Use until the real Aptos client is wired.
 */
export class MockMoveContractClient implements MoveContractClient {
  private drops = new Map<string, ChainDrop>()
  private resets: { dropId: string; round: number }[] = []

  async createDrop(args: CreateDropArgs): Promise<{ contractRef: string }> {
    if (this.drops.has(args.dropId)) throw new Error(`drop already on-chain: ${args.dropId}`)
    if (args.mode === "multisig") {
      if (!args.threshold || !args.signers || !args.signerBlsPubkeys || !args.groupPubkey || !args.ibeHeader) {
        throw new Error("multisig createDrop requires threshold, signers, group key, and IBE header")
      }
    }
    const drop: ChainDrop = {
      dropId: args.dropId,
      owner: args.owner,
      mode: args.mode,
      distribution: args.distribution,
      threshold: args.threshold ?? 0,
      signers: args.signers ?? [],
      signerBlsPubkeys: args.signerBlsPubkeys ?? [],
      groupPubkey: args.groupPubkey ?? "",
      encKeyShares: args.encKeyShares ?? [],
      ibeHeader: args.ibeHeader ?? "",
      sigShares: [],
      approvals: [],
      released: false,
    }
    this.drops.set(args.dropId, drop)
    return { contractRef: `mock://drop/${args.dropId}` }
  }

  async approveRelease(dropId: string, signerAddress: string, share: SignatureShare): Promise<void> {
    const drop = this.drops.get(dropId)
    if (!drop) throw new Error(`unknown drop: ${dropId}`)
    if (drop.mode !== "multisig") throw new Error("approveRelease is only valid for multisig drops")

    const signerIdx = drop.signers.indexOf(signerAddress)
    if (signerIdx < 0) throw new Error("not a designated signer")
    // The share's Shamir index must match the signer's position (+1).
    if (share.index !== signerIdx + 1) throw new Error("signature share index does not match signer")

    const blsPubkey = drop.signerBlsPubkeys[signerIdx]
    // The on-chain BLS verify — reject non-signer / malformed / wrong-drop shares.
    if (!verifySignatureShare({ dropId, blsPubkey, share })) {
      throw new Error("invalid signature share")
    }
    if (drop.approvals.includes(signerAddress)) return // idempotent: already approved

    drop.approvals.push(signerAddress)
    drop.sigShares.push(share)
    if (drop.approvals.length >= drop.threshold) drop.released = true
  }

  async getReleaseMaterial(dropId: string): Promise<{ released: boolean; sigShares: SignatureShare[] }> {
    const drop = this.drops.get(dropId)
    if (!drop) throw new Error(`unknown drop: ${dropId}`)
    return { released: drop.released, sigShares: drop.sigShares }
  }

  async recordReset(dropId: string, newReleaseRound: number): Promise<void> {
    this.resets.push({ dropId, round: newReleaseRound })
  }

  async getDrop(dropId: string): Promise<ChainDrop | null> {
    return this.drops.get(dropId) ?? null
  }
}
