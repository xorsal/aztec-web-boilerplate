/**
 * EVMSigner - External signer implementation for EVM wallets
 *
 * Works with any EVM wallet via EIP-6963 discovery.
 * Supports two signing modes:
 * 1. EIP-712 (default): Human-readable typed data signing via eth_signTypedData_v4
 * 2. personal_sign: Raw hash signing (fallback mode)
 *
 * The user's private key never leaves the wallet.
 */

import { type Hex, keccak256, toBytes } from 'viem';
import type { AuthWitnessProvider } from '@aztec/aztec.js/account';
import type { CompleteAddress } from '@aztec/aztec.js/addresses';
import { MetaMaskAuthWitnessProvider } from '../accounts/MetaMaskAuthWitnessProvider';
import {
  Eip712AuthWitnessProvider,
  type Eip712AuthWitnessProviderOptions,
} from '../accounts/Eip712AuthWitnessProvider';
import { getEIP6963Service } from '../services/evm/EIP6963Service';
import { ExternalSignerType } from '../types/aztec';
import {
  recoverPublicKeyFromSignature,
  getPublicKeyRecoveryMessage,
} from '../utils/evmPublicKeyRecovery';
import type { ExternalSigner, ECDSAPublicKey, SigningMode, CapsuleInjector } from './types';
import type { EVMWalletService } from '../services/evm/EVMWalletService';

export class EVMSigner implements ExternalSigner {
  readonly type = ExternalSignerType.EVM_WALLET;
  readonly label = 'EVM Wallet';
  readonly rdns?: string;

  private evmService: EVMWalletService;
  private cachedPublicKey: ECDSAPublicKey | null = null;
  private cachedSecretKey: Buffer | null = null;
  private cachedSalt: Buffer | null = null;

  // EIP-712 support
  private signingMode: SigningMode = 'eip712';
  private capsuleInjector: CapsuleInjector | null = null;
  private authWitnessProvider: AuthWitnessProvider | null = null;
  private chainId: bigint = 31337n;
  private debugEip712: boolean = false;

  constructor(evmService: EVMWalletService, rdns?: string) {
    this.evmService = evmService;
    this.rdns = rdns;
  }

  /**
   * Set the capsule injector for EIP-712 signing.
   * Must be called after PXE initialization before creating transactions.
   *
   * @param injector - The capsule injector (typically pxe.pushCapsule bound)
   */
  setCapsuleInjector(injector: CapsuleInjector): void {
    this.capsuleInjector = injector;
  }

  /**
   * Set the chain ID for EIP-712 domain.
   * Defaults to 31337 (local sandbox).
   *
   * @param chainId - The L1 chain ID
   */
  setChainId(chainId: bigint): void {
    this.chainId = chainId;
  }

  /**
   * Set the signing mode.
   *
   * @param mode - 'eip712' for human-readable signing, 'personal_sign' for raw hash
   */
  setSigningMode(mode: SigningMode): void {
    this.signingMode = mode;
  }

  /**
   * Get the current signing mode.
   */
  getSigningMode(): SigningMode {
    return this.signingMode;
  }

  /**
   * Enable debug logging for EIP-712 signing.
   * When enabled, logs the typed data being sent to MetaMask.
   *
   * @param enabled - Whether to enable debug logging
   */
  setDebugEip712(enabled: boolean): void {
    this.debugEip712 = enabled;
  }

  /**
   * Get the auth witness provider if one has been created.
   * Used to set pending transaction context for EIP-712 signing.
   */
  getAuthWitnessProvider(): AuthWitnessProvider | null {
    return this.authWitnessProvider;
  }

  isAvailable(): boolean {
    if (this.rdns) {
      return getEIP6963Service().isWalletAvailable(this.rdns);
    }
    return this.evmService.isAvailable();
  }

  isConnected(): boolean {
    if (!this.evmService.isConnected()) {
      return false;
    }
    const connectedRdns = this.evmService.getConnectedRdns();
    if (!this.rdns) {
      return true;
    }
    return connectedRdns === this.rdns;
  }

  async connect(): Promise<void> {
    // If already connected to this specific wallet, skip
    if (this.isConnected()) {
      return;
    }

    // Get specific provider via EIP-6963 if rdns is set
    const provider = this.rdns
      ? getEIP6963Service().getProviderByRdns(this.rdns)
      : null;

    if (this.rdns && !provider) {
      console.warn(
        `[EVMSigner] Wallet ${this.rdns} not found via EIP-6963, falling back to window.ethereum`
      );
    }

    await this.evmService.connect(provider ?? undefined, this.rdns);
  }

  disconnect(): void {
    this.evmService.disconnect();
    this.clearCache();
  }

  getEVMAddress(): string | null {
    return this.evmService.getAddress();
  }

  async getPublicKey(): Promise<ECDSAPublicKey> {
    if (this.cachedPublicKey) {
      return this.cachedPublicKey;
    }

    const walletClient = this.evmService.getWalletClient();
    if (!walletClient) {
      throw new Error('EVM wallet client not available');
    }

    const address = this.evmService.getAddress();
    if (!address) {
      throw new Error('EVM wallet not connected');
    }

    const message = getPublicKeyRecoveryMessage(address);

    const signature = await walletClient.signMessage({
      account: address,
      message,
    });

    this.cacheSignatureDerivatives(signature, address);

    const publicKey = await recoverPublicKeyFromSignature(message, signature);
    this.cachedPublicKey = publicKey;

    return publicKey;
  }

  createAuthWitnessProvider(completeAddress: CompleteAddress): AuthWitnessProvider {
    const walletClient = this.evmService.getWalletClient();
    const address = this.evmService.getAddress();

    if (!walletClient || !address) {
      throw new Error('EVM wallet not connected');
    }

    // EIP-712 mode: requires capsule injector for witness data
    if (this.signingMode === 'eip712') {
      if (!this.capsuleInjector) {
        console.warn(
          '[EVMSigner] No capsule injector set, falling back to personal_sign mode'
        );
        this.authWitnessProvider = new MetaMaskAuthWitnessProvider(walletClient, address);
        return this.authWitnessProvider;
      }

      const options: Eip712AuthWitnessProviderOptions = {
        walletClient,
        account: address as Hex,
        contractAddress: completeAddress.address,
        capsuleInjector: this.capsuleInjector,
        chainId: this.chainId,
        debug: this.debugEip712,
      };

      this.authWitnessProvider = new Eip712AuthWitnessProvider(options);
      return this.authWitnessProvider;
    }

    // personal_sign mode: basic hash signing
    this.authWitnessProvider = new MetaMaskAuthWitnessProvider(walletClient, address);
    return this.authWitnessProvider;
  }

  async deriveSecretKey(): Promise<Buffer> {
    if (this.cachedSecretKey) {
      return this.cachedSecretKey;
    }

    await this.getPublicKey();

    if (!this.cachedSecretKey) {
      throw new Error('Secret key derivation failed - no signature cached');
    }

    return this.cachedSecretKey;
  }

  deriveSalt(): Buffer {
    if (this.cachedSalt) {
      return this.cachedSalt;
    }

    const address = this.getEVMAddress();
    if (!address) {
      throw new Error('EVM wallet not connected');
    }

    const addressBytes = Buffer.from(address.slice(2).padStart(64, '0'), 'hex');
    this.cachedSalt = addressBytes.slice(0, 32);

    return this.cachedSalt;
  }

  private cacheSignatureDerivatives(signature: Hex, _address: Hex): void {
    const signatureHash = keccak256(toBytes(signature));
    this.cachedSecretKey = Buffer.from(signatureHash.slice(2), 'hex');
  }

  private clearCache(): void {
    this.cachedPublicKey = null;
    this.cachedSecretKey = null;
    this.cachedSalt = null;
    this.authWitnessProvider = null;
    this.capsuleInjector = null;
  }
}

export const createEVMSigner = (
  evmService: EVMWalletService,
  rdns?: string
): EVMSigner => {
  return new EVMSigner(evmService, rdns);
};
