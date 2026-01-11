/**
 * EIP-712 Auth Witness Provider
 *
 * This provider creates auth witnesses using EIP-712 typed data signing.
 * Unlike the basic MetaMaskAuthWitnessProvider that uses personal_sign,
 * this provider shows human-readable function names and arguments.
 *
 * Two modes of operation:
 * 1. Entrypoint Authorization (AppPayload): Signs batch of up to 5 function calls
 * 2. Individual Authwit: Signs single function call for approve/transfer patterns
 *
 * The signed data is delivered to the Noir contract via Capsule (oracle injection),
 * not via the standard AuthWitness mechanism.
 */

import type { AuthWitnessProvider } from '@aztec/aztec.js/account';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import { AuthWitness } from '@aztec/stdlib/auth-witness';
import type { Capsule } from '@aztec/stdlib/tx';
import type { Hex, WalletClient } from 'viem';
import {
  Eip712Account,
  type FunctionCallInput,
} from '../lib/eip712';
import { DEFAULT_VERIFYING_CONTRACT } from '../lib/eip712/eip712-types';

/**
 * Interface for PXE capsule injection
 */
export interface CapsuleInjector {
  pushCapsule(capsule: Capsule): Promise<void>;
}

/**
 * Options for creating an Eip712AuthWitnessProvider
 */
export interface Eip712AuthWitnessProviderOptions {
  /** Viem wallet client connected to MetaMask */
  walletClient: WalletClient;
  /** The connected Ethereum address */
  account: Hex;
  /** The account contract address */
  contractAddress: AztecAddress;
  /** Injector for pushing capsules to PXE (typically PXE.pushCapsule) */
  capsuleInjector: CapsuleInjector;
  /** Optional chain ID (defaults to 31337 for sandbox) */
  chainId?: bigint;
  /** Optional verifying contract address */
  verifyingContract?: Hex;
}

/**
 * Pending transaction context for EIP-712 signing
 */
export interface PendingTxContext {
  /** Function calls to be authorized */
  calls: FunctionCallInput[];
  /** Transaction nonce */
  txNonce: bigint;
}

/**
 * AuthWitnessProvider that uses EIP-712 typed data signing for human-readable
 * transaction authorization via MetaMask.
 *
 * This provider:
 * 1. Receives the outer_hash from Aztec
 * 2. Looks up pending transaction context (function calls)
 * 3. Builds EIP-712 typed data showing function names/args
 * 4. Prompts MetaMask for signature via eth_signTypedData_v4
 * 5. Injects witness data via Capsule to PXE
 * 6. Returns empty AuthWitness (actual data via Capsule)
 *
 * For initial deployment (no pending context), falls back to personal_sign.
 */
export class Eip712AuthWitnessProvider implements AuthWitnessProvider {
  private readonly walletClient: WalletClient;
  private readonly account: Hex;
  private readonly contractAddress: AztecAddress;
  private readonly capsuleInjector: CapsuleInjector;
  private readonly chainId: bigint;
  private readonly verifyingContract: Hex;
  private readonly eip712Account: Eip712Account;

  // Pending transaction context (set before tx simulation)
  private pendingTxContext: PendingTxContext | null = null;

  constructor(options: Eip712AuthWitnessProviderOptions) {
    this.walletClient = options.walletClient;
    this.account = options.account;
    this.contractAddress = options.contractAddress;
    this.capsuleInjector = options.capsuleInjector;
    this.chainId = options.chainId ?? 31337n;
    this.verifyingContract = options.verifyingContract ?? DEFAULT_VERIFYING_CONTRACT;

    // Create Eip712Account for signing (we need the private key for local signing)
    // For MetaMask integration, we'll use signTypedData directly
    this.eip712Account = new Eip712Account(undefined, this.chainId);
  }

  /**
   * Set pending transaction context before simulation.
   * This tells the provider what function calls to include in the EIP-712 data.
   *
   * @param context - The pending transaction context
   */
  setPendingTxContext(context: PendingTxContext): void {
    this.pendingTxContext = context;
  }

  /**
   * Clear pending transaction context after use.
   */
  clearPendingTxContext(): void {
    this.pendingTxContext = null;
  }

  /**
   * Create an auth witness for the given message hash.
   *
   * If pending tx context exists:
   * - Build EIP-712 typed data with function calls
   * - Sign with MetaMask's eth_signTypedData_v4
   * - Inject capsule to PXE
   * - Return empty AuthWitness
   *
   * If no context (deployment):
   * - Fall back to personal_sign for initial account deployment
   *
   * @param messageHash - The outer_hash from Aztec
   * @returns AuthWitness (empty for EIP-712, signature fields for fallback)
   */
  async createAuthWit(messageHash: Fr): Promise<AuthWitness> {
    if (this.pendingTxContext) {
      return this.createEip712AuthWit(messageHash);
    } else {
      // Fallback to personal_sign for deployment
      return this.createFallbackAuthWit(messageHash);
    }
  }

  /**
   * Create EIP-712 typed data auth witness.
   * Signs with MetaMask and injects capsule.
   */
  private async createEip712AuthWit(messageHash: Fr): Promise<AuthWitness> {
    const context = this.pendingTxContext!;

    // Build EIP-712 typed data
    const typedData = this.buildTypedData(context.calls, context.txNonce);

    // Sign with MetaMask
    const signature = await this.walletClient.signTypedData({
      account: this.account,
      ...typedData,
    });

    // Parse signature (remove v, keep r || s)
    const sigBytes = hexToBytes(signature);
    const ecdsaSignature = sigBytes.slice(0, 64);

    // Build capsule data
    const capsule = await this.eip712Account.createWitnessCapsule5(
      context.calls,
      context.txNonce,
      this.contractAddress,
      this.verifyingContract
    );

    // Inject capsule to PXE
    await this.capsuleInjector.pushCapsule(capsule);

    // Return empty AuthWitness (actual data via Capsule)
    // The contract will read from capsule slot EIP712_WITNESS_5_SLOT
    return new AuthWitness(messageHash, []);
  }

  /**
   * Fallback to personal_sign for initial deployment.
   * This is used when the account contract hasn't been deployed yet.
   */
  private async createFallbackAuthWit(messageHash: Fr): Promise<AuthWitness> {
    // Convert Fr to 32-byte buffer for MetaMask
    const messageBytes = messageHash.toBuffer();

    // Call MetaMask signMessage with raw bytes
    const signature = await this.walletClient.signMessage({
      account: this.account,
      message: { raw: messageBytes },
    });

    // Parse the signature (65 bytes: r[32] + s[32] + v[1])
    const sigHex = signature.slice(2);
    const r = Buffer.from(sigHex.slice(0, 64), 'hex');
    const s = Buffer.from(sigHex.slice(64, 128), 'hex');

    // Convert signature bytes to Field array (64 fields, one per byte)
    const witnessFields: Fr[] = [];
    for (let i = 0; i < 32; i++) {
      witnessFields.push(new Fr(r[i]));
    }
    for (let i = 0; i < 32; i++) {
      witnessFields.push(new Fr(s[i]));
    }

    return new AuthWitness(messageHash, witnessFields);
  }

  /**
   * Build EIP-712 typed data for MetaMask signing.
   */
  private buildTypedData(calls: FunctionCallInput[], txNonce: bigint) {
    // Import encoder to build typed data
    const { Eip712Encoder, DEFAULT_APP_DOMAIN } = require('../lib/eip712/eip712-encoder');

    const encoder = new Eip712Encoder({ chainId: this.chainId });

    // Convert FunctionCallInput to FunctionCall format
    const functionCalls = calls.map((call) =>
      Eip712Encoder.createFunctionCall(
        call.targetAddress,
        call.functionSignature,
        call.args
      )
    );

    // Build typed data
    return encoder.buildEntrypointTypedData5(
      functionCalls,
      txNonce,
      this.verifyingContract
    );
  }
}

/**
 * Create an Eip712AuthWitnessProvider from MetaMask connection.
 *
 * @param options - Provider options
 * @returns Configured Eip712AuthWitnessProvider
 */
export function createEip712AuthWitnessProvider(
  options: Eip712AuthWitnessProviderOptions
): Eip712AuthWitnessProvider {
  return new Eip712AuthWitnessProvider(options);
}
