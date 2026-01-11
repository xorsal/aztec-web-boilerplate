/**
 * EIP-712 Account Contract Implementation
 *
 * This AccountContract implementation uses EIP-712 typed data signing
 * for human-readable transaction authorization via MetaMask.
 *
 * Unlike standard ECDSA accounts that sign raw hashes, this account:
 * 1. Shows users readable function names and arguments in MetaMask
 * 2. Uses a 5-call entrypoint for batched transactions
 * 3. Supports individual authwits for approve/transfer patterns
 * 4. Falls back to personal_sign for initial deployment
 */

import { DefaultAccountInterface } from '@aztec/accounts/defaults';
import type { ContractArtifact } from '@aztec/aztec.js/abi';
import type {
  AccountContract,
  AccountInterface,
  AuthWitnessProvider,
  ChainInfo,
} from '@aztec/aztec.js/account';
import type { CompleteAddress } from '@aztec/aztec.js/addresses';
import { Eip712AccountContractArtifact } from '../artifacts/Eip712Account';
import { Eip712AccountInterface } from './Eip712AccountInterface';
import type { Eip712AuthWitnessProvider } from './Eip712AuthWitnessProvider';

/**
 * AccountContract implementation for EIP-712 accounts that use
 * typed data signing for human-readable authorization.
 *
 * This account contract:
 * 1. Takes the public key coordinates (x, y) during construction
 * 2. Delegates signing to an Eip712AuthWitnessProvider
 * 3. Shows human-readable function calls in MetaMask
 *
 * The Noir contract verifies EIP-712 typed data signatures:
 * - Builds EIP-712 domain separator with verifyingContract
 * - Computes typed data hash of function calls
 * - Verifies secp256k1 ECDSA signature
 */
export class Eip712AccountContract implements AccountContract {
  private readonly publicKeyX: Buffer;
  private readonly publicKeyY: Buffer;
  private readonly authWitnessProvider: AuthWitnessProvider;

  /**
   * Creates a new Eip712AccountContract.
   *
   * @param publicKeyX - The x coordinate of the secp256k1 public key (32 bytes)
   * @param publicKeyY - The y coordinate of the secp256k1 public key (32 bytes)
   * @param authWitnessProvider - Provider that handles EIP-712 signing
   */
  constructor(
    publicKeyX: Buffer,
    publicKeyY: Buffer,
    authWitnessProvider: AuthWitnessProvider
  ) {
    if (publicKeyX.length !== 32 || publicKeyY.length !== 32) {
      throw new Error('Public key coordinates must be 32 bytes each');
    }
    this.publicKeyX = publicKeyX;
    this.publicKeyY = publicKeyY;
    this.authWitnessProvider = authWitnessProvider;
  }

  /**
   * Returns the contract artifact for deployment.
   */
  getContractArtifact(): Promise<ContractArtifact> {
    return Promise.resolve(Eip712AccountContractArtifact);
  }

  /**
   * Returns the initialization function and its arguments.
   * The constructor takes the public key coordinates as u8 arrays.
   */
  async getInitializationFunctionAndArgs(): Promise<{
    constructorName: string;
    constructorArgs: unknown[];
  }> {
    return {
      constructorName: 'constructor',
      constructorArgs: [
        Array.from(this.publicKeyX), // Convert Buffer to number array for Noir
        Array.from(this.publicKeyY),
      ],
    };
  }

  /**
   * Returns the account interface for creating tx requests.
   *
   * Uses Eip712AccountInterface only for Eip712AuthWitnessProvider.
   * Falls back to DefaultAccountInterface for other providers (e.g., mocks).
   */
  getInterface(
    address: CompleteAddress,
    chainInfo: ChainInfo
  ): AccountInterface {
    const provider = this.getAuthWitnessProvider(address);

    // Check if this is an Eip712AuthWitnessProvider (has hasPendingTxContext method)
    const eip712Provider = provider as Eip712AuthWitnessProvider;
    if (typeof eip712Provider.hasPendingTxContext === 'function') {
      // Use Eip712AccountInterface which dynamically selects entrypoint
      return new Eip712AccountInterface(provider, address, chainInfo);
    }

    // Use DefaultAccountInterface for other providers (mocks, etc.)
    return new DefaultAccountInterface(provider, address, chainInfo);
  }

  /**
   * Returns the auth witness provider.
   * This delegates to EIP-712 signing.
   */
  getAuthWitnessProvider(_address: CompleteAddress): AuthWitnessProvider {
    return this.authWitnessProvider;
  }
}
