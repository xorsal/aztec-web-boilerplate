/**
 * useExternalSignerWallet - Hook for External Signer wallet management
 *
 * Manages wallets that use app-managed PXE with external signing (MetaMask, etc.)
 * This is the generic hook that works with any ExternalSigner implementation.
 */

import { useState, useCallback, useRef } from 'react';
import type { AccountWithSecretKey } from '@aztec/aztec.js/account';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { Fr } from '@aztec/aztec.js/fields';
import { AccountManager } from '@aztec/aztec.js/wallet';
import { poseidon2Hash } from '@aztec/foundation/crypto/poseidon';
import type { PXE } from '@aztec/pxe/server';
import { Eip712AccountContract } from '../../accounts/Eip712AccountContract';
import type { Eip712AuthWitnessProvider } from '../../accounts/Eip712AuthWitnessProvider';
import type { EVMSigner } from '../../signers/EVMSigner';
import { ExternalSignerType } from '../../types/aztec';
import { useError } from '../ErrorProvider';
import { useSharedPXE, type UseSharedPXEReturn } from './useSharedPXE';
import type { NetworkConfig } from '../../config/networks';
import type { ExternalSigner } from '../../signers/types';
import type { ConnectionStatus } from '../../types/walletConnector';
import type { MinimalWallet } from '../../utils/MinimalWallet';

export interface ExternalSignerWalletState {
  aztecAccount: AccountWithSecretKey | null;
  signerType: ExternalSignerType | null;
  connectedRdns: string | null;
  status: ConnectionStatus;
  isInitialized: boolean;
}

export interface ExternalSignerWalletActions {
  connect: (signer: ExternalSigner) => Promise<AccountWithSecretKey>;
  disconnect: () => void;
}

export interface ExternalSignerWalletServices {
  pxe: PXE | null;
  wallet: MinimalWallet | null;
  getSponsoredFeePaymentMethod: () => Promise<SponsoredFeePaymentMethod>;
  /** EIP-712 auth witness provider for setting transaction context */
  authWitnessProvider: Eip712AuthWitnessProvider | null;
}

export interface UseExternalSignerWalletReturn {
  state: ExternalSignerWalletState;
  actions: ExternalSignerWalletActions;
  services: ExternalSignerWalletServices;
  sharedPXE: UseSharedPXEReturn;
  error: string | null;
}

interface UseExternalSignerWalletOptions {
  config: NetworkConfig;
}

/**
 * Hook for managing External Signer wallets (MetaMask, WalletConnect, etc.)
 *
 * Uses shared PXE with lazy initialization - PXE is only created when connect() is called.
 */
export const useExternalSignerWallet = (
  options: UseExternalSignerWalletOptions
): UseExternalSignerWalletReturn => {
  const { config } = options;

  // Use shared PXE (lazy initialization)
  const sharedPXE = useSharedPXE({ config, autoInitialize: false });

  // Local state
  const [aztecAccount, setAztecAccount] = useState<AccountWithSecretKey | null>(
    null
  );
  const [signerType, setSignerType] = useState<ExternalSignerType | null>(null);
  const [connectedRdns, setConnectedRdns] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [authWitnessProvider, setAuthWitnessProvider] =
    useState<Eip712AuthWitnessProvider | null>(null);

  const currentSignerRef = useRef<ExternalSigner | null>(null);
  const { addMessage } = useError();

  const connect = useCallback(
    async (signer: ExternalSigner): Promise<AccountWithSecretKey> => {
      setStatus('connecting');
      setError(null);

      try {
        // Step 1: Connect to external wallet if not already connected
        if (!signer.isConnected()) {
          await signer.connect();
        }

        // Step 2: Initialize shared PXE (lazy)
        const pxeInstance = await sharedPXE.actions.initialize();

        // Step 2.5: Set capsule injector for EIP-712 signing (if EVMSigner)
        const evmSigner = signer as EVMSigner;
        if (evmSigner.setCapsuleInjector && pxeInstance.storeCapsule) {
          evmSigner.setCapsuleInjector({
            pushCapsule: (capsule) => pxeInstance.storeCapsule(capsule),
          });
          // Also set chain ID from network config
          if (evmSigner.setChainId && config.chainId) {
            evmSigner.setChainId(BigInt(config.chainId));
          }
          // Enable debug logging if localStorage flag is set
          // To enable: localStorage.setItem('EIP712_DEBUG', 'true') in browser console
          if (evmSigner.setDebugEip712) {
            const debugEnabled = typeof window !== 'undefined' &&
              localStorage.getItem('EIP712_DEBUG') === 'true';
            evmSigner.setDebugEip712(debugEnabled);
          }
        }

        // Step 3: Get public key from signer (requires signature)
        const { x, y } = await signer.getPublicKey();

        // Step 4: Derive keys (need these before creating account contract)
        const secretKeyBuffer = await signer.deriveSecretKey();
        const secretKey = await poseidon2Hash([Fr.fromBuffer(secretKeyBuffer)]);
        const salt = Fr.fromBuffer(signer.deriveSalt());

        // Step 5: Create AccountManager first to get the account address
        // We need the address before creating the auth witness provider
        const wallet = pxeInstance.wallet;

        // Create a temporary account contract to get the address
        const tempAccountContract = new Eip712AccountContract(
          x,
          y,
          { createAuthWit: async () => { throw new Error('temp'); } } as any
        );

        const tempAccountManager = await AccountManager.create(
          wallet,
          secretKey,
          tempAccountContract,
          salt
        );

        const accountAddress = await tempAccountManager.getCompleteAddress();

        // Step 6: Now create the auth witness provider with the account address
        const witnessProvider = signer.createAuthWitnessProvider(accountAddress);

        // Save the auth witness provider if it's an Eip712AuthWitnessProvider
        const eip712Provider = witnessProvider as Eip712AuthWitnessProvider;
        if (eip712Provider.setPendingTxContext) {
          setAuthWitnessProvider(eip712Provider);
        }

        // Step 7: Create the actual account contract with the provider
        const accountContract = new Eip712AccountContract(
          x,
          y,
          witnessProvider
        );

        // Step 8: Create the real AccountManager with the proper account contract
        const accountManager = await AccountManager.create(
          wallet,
          secretKey,
          accountContract,
          salt
        );

        const account = await accountManager.getAccount();

        // Register contract with PXE
        const instance = accountManager.getInstance();
        const artifact = await accountManager
          .getAccountContract()
          .getContractArtifact();
        await wallet.registerContract(
          instance,
          artifact,
          accountManager.getSecretKey()
        );

        // Add account to wallet
        wallet.addAccount(account);

        console.log(
          `✅ External Signer (${signer.type}) Aztec account created:`,
          accountManager.address.toString()
        );

        // Step 9: Deploy account if needed
        setStatus('deploying');
        try {
          const metadata = await wallet.getContractMetadata(accountManager.address);
          if (!metadata.isContractInitialized) {
            console.log('🚀 Deploying account contract...');
            const deployMethod = await accountManager.getDeployMethod();
            const paymentMethod =
              await pxeInstance.getSponsoredFeePaymentMethod();

            await deployMethod
              .send({
                from: AztecAddress.ZERO,
                fee: { paymentMethod },
                skipClassPublication: true,
                skipInstancePublication: true,
              })
              .wait({ timeout: 120 });
            console.log('✅ Account deployed successfully');
          } else {
            console.log('ℹ️ Account already deployed');
          }
        } catch (deployErr) {
          const errMsg =
            deployErr instanceof Error ? deployErr.message : String(deployErr);
          // Check if this is an "Existing nullifier" error - means account is already deployed
          if (
            errMsg.includes('Existing nullifier') ||
            errMsg.includes('already deployed')
          ) {
            console.log(
              'ℹ️ Account already deployed (deterministic salt reuse)'
            );
          } else {
            console.error('❌ Account deployment failed:', deployErr);
            addMessage({
              message: 'Account deployment failed',
              type: 'warning',
              source: 'wallet',
              details: errMsg,
            });
          }
        }

        // Update state
        currentSignerRef.current = signer;
        setAztecAccount(account);
        setSignerType(signer.type);
        setConnectedRdns(signer.rdns ?? null);
        setStatus('connected');

        return account;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Connection failed';
        setError(message);
        setStatus('disconnected');
        console.error('External Signer connection failed:', err);

        // Disconnect the signer so next attempt can use a different wallet
        signer.disconnect();

        addMessage({
          message: 'Failed to create Aztec account',
          type: 'error',
          source: 'wallet',
          details: message,
        });
        throw err;
      }
    },
    [sharedPXE, addMessage, config]
  );

  const disconnect = useCallback(() => {
    if (currentSignerRef.current) {
      currentSignerRef.current.disconnect();
      currentSignerRef.current = null;
    }
    setAztecAccount(null);
    setSignerType(null);
    setConnectedRdns(null);
    setError(null);
    setStatus('disconnected');
    setAuthWitnessProvider(null);
  }, []);

  return {
    state: {
      aztecAccount,
      signerType,
      connectedRdns,
      status,
      isInitialized: sharedPXE.state.isInitialized,
    },
    actions: {
      connect,
      disconnect,
    },
    services: {
      pxe: sharedPXE.services.pxe,
      wallet: sharedPXE.services.wallet,
      getSponsoredFeePaymentMethod:
        sharedPXE.services.getSponsoredFeePaymentMethod,
      authWitnessProvider,
    },
    sharedPXE,
    error,
  };
};
