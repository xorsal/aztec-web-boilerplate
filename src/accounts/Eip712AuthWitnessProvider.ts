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
import { type Hex, type WalletClient, hexToBytes } from 'viem';
import {
  Eip712Account,
  Eip712Encoder,
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
  /** Enable debug logging to see typed data sent to MetaMask */
  debug?: boolean;
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
  private readonly debug: boolean;

  // Pending transaction context (set before tx simulation)
  private pendingTxContext: PendingTxContext | null = null;

  // Cached signature to avoid double-signing during simulate + send
  private cachedSignature: {
    txNonce: string;
    signature: Uint8Array;
    capsule: Capsule;
  } | null = null;

  constructor(options: Eip712AuthWitnessProviderOptions) {
    this.walletClient = options.walletClient;
    this.account = options.account;
    this.contractAddress = options.contractAddress;
    this.capsuleInjector = options.capsuleInjector;
    this.chainId = options.chainId ?? 31337n;
    this.verifyingContract = options.verifyingContract ?? DEFAULT_VERIFYING_CONTRACT;
    this.debug = options.debug ?? false;

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
   * Also clears the cached signature to ensure fresh signing on next transaction.
   */
  clearPendingTxContext(): void {
    this.pendingTxContext = null;
    this.cachedSignature = null;
  }

  /**
   * Check if there is pending transaction context.
   * Used to determine which entrypoint to use (entrypoint5 vs entrypoint).
   */
  hasPendingTxContext(): boolean {
    return this.pendingTxContext !== null;
  }

  /**
   * Get the pending transaction context.
   * Used by the entrypoint to ensure the same txNonce is used for the AppPayload.
   */
  getPendingTxContext(): PendingTxContext | null {
    return this.pendingTxContext;
  }

  /**
   * Get the cached capsule from the last createAuthWit call.
   * Used by the entrypoint to include the capsule in the TxExecutionRequest.
   */
  getCachedCapsule(): Capsule | null {
    return this.cachedSignature?.capsule ?? null;
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
   *
   * Uses signature caching to avoid prompting MetaMask twice during simulate + send.
   * If we already have a cached signature for the current txNonce, we reuse it.
   */
  private async createEip712AuthWit(messageHash: Fr): Promise<AuthWitness> {
    const context = this.pendingTxContext!;
    const txNonceKey = context.txNonce.toString();

    console.log('[Eip712AuthWitnessProvider] Creating EIP-712 auth witness:', {
      callCount: context.calls.length,
      txNonce: txNonceKey,
      hasCachedSignature: this.cachedSignature?.txNonce === txNonceKey,
      calls: context.calls.map((c, i) => ({
        index: i,
        targetAddress: c.targetAddress.toString(16),
        functionSignature: c.functionSignature,
        argsCount: c.args.length,
      })),
    });

    // Check if we already have a cached signature for this txNonce
    if (this.cachedSignature && this.cachedSignature.txNonce === txNonceKey) {
      console.log('[Eip712AuthWitnessProvider] Reusing cached signature for txNonce:', txNonceKey);

      // Re-inject the cached capsule to PXE (may have been consumed during simulation)
      await this.capsuleInjector.pushCapsule(this.cachedSignature.capsule);

      console.log('[Eip712AuthWitnessProvider] Cached capsule re-injected to PXE');

      // Return empty AuthWitness (actual data via Capsule)
      return new AuthWitness(messageHash, []);
    }

    // Build EIP-712 typed data
    const typedData = this.buildTypedData(context.calls, context.txNonce);

    // Debug: Log what will be shown to the user in MetaMask
    if (this.debug) {
      this.logTypedData(typedData, context);
    }

    // Sign with MetaMask
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signature = await this.walletClient.signTypedData(typedData as any);

    console.log('[Eip712AuthWitnessProvider] Got signature from MetaMask:', {
      signatureLength: signature.length,
      signaturePrefix: signature.slice(0, 20) + '...',
    });

    // Parse signature (remove v, keep r || s)
    const sigBytes = hexToBytes(signature);
    const ecdsaSignature = sigBytes.slice(0, 64);

    // Build capsule data using MetaMask signature (not internal signing)
    const capsule = this.eip712Account.createWitnessCapsule5WithExternalSignature(
      context.calls,
      context.txNonce,
      ecdsaSignature,
      this.contractAddress,
      this.verifyingContract
    );

    console.log('[Eip712AuthWitnessProvider] Capsule created:', {
      contractAddress: this.contractAddress.toString(),
      capsuleFieldCount: capsule.data.length,
    });

    // Cache the signature and capsule for potential reuse during send()
    this.cachedSignature = {
      txNonce: txNonceKey,
      signature: ecdsaSignature,
      capsule,
    };

    console.log('[Eip712AuthWitnessProvider] Signature cached for txNonce:', txNonceKey);

    // Inject capsule to PXE
    await this.capsuleInjector.pushCapsule(capsule);

    console.log('[Eip712AuthWitnessProvider] Capsule injected to PXE');

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
   *
   * IMPORTANT: For public functions, the args in the typed data must include
   * the selector (prepended) to match what goes into the capsule. The Noir
   * contract reconstructs the hash from capsule data, so they must match.
   */
  private buildTypedData(calls: FunctionCallInput[], txNonce: bigint) {
    const encoder = new Eip712Encoder({ chainId: this.chainId });

    // Convert FunctionCallInput to FunctionCall format
    // For public functions, prepend the selector to args to match capsule data
    const functionCalls = calls.map((call) => {
      const argsForTypedData = call.isPublic && call.selector !== undefined
        ? [call.selector, ...call.args]
        : call.args;

      // isPrivate is the inverse of isPublic
      const isPrivate = !call.isPublic;

      return Eip712Encoder.createFunctionCall(
        call.targetAddress,
        call.functionSignature,
        argsForTypedData,
        isPrivate
      );
    });

    // Build typed data
    return encoder.buildEntrypointTypedData5(
      functionCalls,
      txNonce,
      this.verifyingContract
    );
  }

  /**
   * Log the EIP-712 typed data for debugging.
   * Shows what the user will see in MetaMask.
   */
  private logTypedData(typedData: any, context: PendingTxContext): void {
    const separator = '─'.repeat(60);

    console.log('\n' + separator);
    console.log('🔐 EIP-712 CLEAR SIGNING - MetaMask Will Show:');
    console.log(separator);

    // Domain info
    console.log('\n📋 Domain:');
    console.log(`   Name: ${typedData.domain.name}`);
    console.log(`   Version: ${typedData.domain.version}`);
    console.log(`   Chain ID: ${typedData.domain.chainId}`);
    console.log(`   Verifying Contract: ${typedData.domain.verifyingContract}`);

    // Function calls
    console.log('\n📝 Function Calls:');
    context.calls.forEach((call, index) => {
      const argsForDisplay = call.isPublic && call.selector !== undefined
        ? [call.selector, ...call.args]
        : call.args;
      console.log(`\n   [${index + 1}] ${call.functionSignature}${call.isPublic ? ' (public)' : ''}`);
      console.log(`       Target: 0x${call.targetAddress.toString(16).padStart(64, '0').slice(0, 16)}...`);
      console.log(`       Args: [${argsForDisplay.map(a => a.toString()).join(', ')}]`);
      if (call.isPublic && call.selector !== undefined) {
        console.log(`       (includes selector: ${call.selector})`);
      }
    });

    // Transaction nonce
    console.log(`\n🔢 Tx Nonce: ${context.txNonce}`);

    console.log('\n' + separator);
    console.log('📱 Waiting for MetaMask signature...');
    console.log(separator + '\n');
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
