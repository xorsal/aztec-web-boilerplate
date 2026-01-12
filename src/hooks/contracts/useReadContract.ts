import { useState, useCallback } from 'react';
import type { ContractArtifact } from '@aztec/aztec.js/abi';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, type ContractBase } from '@aztec/aztec.js/contracts';
import { SimulateViewsOp } from '../../types';
import {
  isEmbeddedConnector,
  isBrowserWalletConnector,
  isExternalSignerConnector,
  hasAppManagedPXE,
} from '../../types/walletConnector';
import { useUniversalWallet } from '../context/useUniversalWallet';
import { getContractMethod } from './utils';
import { buildFunctionCallInput } from '../../utils/eip712-helpers';
import type { Eip712AuthWitnessProvider } from '../../accounts/Eip712AuthWitnessProvider';
import type {
  MethodsOf,
  ArgsOf,
  ReadContractResult,
} from '../../types/contractTypes';

/**
 * BN254 scalar field modulus (Fr modulus for Aztec's curve)
 */
const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Generate a random txNonce for EIP-712 signing.
 */
function generateRandomTxNonce(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value % FR_MODULUS;
}

/**
 * Type helper to extract contract type from a contract class.
 * Uses the static `at` method signature to infer the contract instance type.
 */
type ContractClassFor<TContract extends ContractBase> = {
  artifact: ContractArtifact;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  at: (...args: any[]) => Promise<TContract>;
};

interface ReadContractParams<
  TContract extends ContractBase,
  TMethod extends MethodsOf<TContract> = MethodsOf<TContract>,
> {
  /** Contract class - used for type inference and artifact */
  contract: ContractClassFor<TContract>;
  /** Contract address */
  address: string;
  /** Method name to call */
  functionName: TMethod;
  /** Method arguments */
  args: ArgsOf<TContract, TMethod>;
}

/**
 * Hook for executing read/simulate operations on Aztec contracts.
 * Handles embedded, browser wallet, and external signer (MetaMask) flows.
 *
 * For External Signer wallets, this hook supports EIP-712 clear signing,
 * showing the user the function name and arguments in MetaMask.
 *
 * @example
 * ```tsx
 * const { readContract, isPending } = useReadContract();
 *
 * // TypeScript infers method type from functionName
 * const result = await readContract({
 *   contract: TokenContract,
 *   address: tokenAddress,
 *   functionName: 'balance_of_public',
 *   args: [ownerAddress],
 * });
 * ```
 */
export const useReadContract = () => {
  const { connector, account, currentConfig, authWitnessProvider } = useUniversalWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readContract = useCallback(
    async <
      TContract extends ContractBase,
      TMethod extends MethodsOf<TContract> = MethodsOf<TContract>,
      TResult = unknown,
    >(
      params: ReadContractParams<TContract, TMethod>
    ): Promise<ReadContractResult<TResult>> => {
      const { contract, address, functionName, args } = params;
      const artifact = contract.artifact;

      if (!connector || !account) {
        return { success: false, error: 'Wallet not connected' };
      }

      setIsPending(true);
      setError(null);

      try {
        // ========== BROWSER WALLET FLOW ==========
        if (isBrowserWalletConnector(connector)) {
          const selectedAccount = connector.getCaipAccount();
          if (!selectedAccount) {
            const errorMsg = 'Browser wallet account not selected';
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          const operation: SimulateViewsOp = {
            kind: 'simulate_views',
            account: selectedAccount,
            calls: [
              {
                kind: 'call',
                contract: address,
                method: String(functionName),
                args: args as unknown[],
              },
            ],
          };

          const result = await connector.executeOperation(operation);

          if (result.status !== 'ok') {
            const errorMsg =
              'error' in result && result.error
                ? result.error
                : 'Simulation failed';
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          return {
            success: true,
            data: result.result as TResult,
          };
        }

        // ========== EMBEDDED WALLET FLOW ==========
        if (isEmbeddedConnector(connector)) {
          const wallet = connector.getWallet();
          if (!wallet) {
            const errorMsg = 'Wallet instance not available';
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          const contractAddress = AztecAddress.fromString(address);
          const contract = await Contract.at(contractAddress, artifact, wallet);

          const method = getContractMethod(contract, String(functionName));
          if (!method) {
            const errorMsg = `Method ${String(functionName)} not found on contract`;
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          // Cast safe: args validated by ArgsOf<TContract, TMethod> at call site
          const result = await method(...(args as unknown[])).simulate({
            from: account.getAddress(),
          });

          return {
            success: true,
            data: result as TResult,
          };
        }

        // ========== EXTERNAL SIGNER (MetaMask) FLOW ==========
        // This flow uses EIP-712 clear signing for view functions
        if (hasAppManagedPXE(connector) && isExternalSignerConnector(connector)) {
          const wallet = connector.getWallet();
          if (!wallet) {
            const errorMsg = 'Wallet instance not available';
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          const contractAddress = AztecAddress.fromString(address);
          const contract = await Contract.at(contractAddress, artifact, wallet);

          const method = getContractMethod(contract, String(functionName));
          if (!method) {
            const errorMsg = `Method ${String(functionName)} not found on contract`;
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          // Set up EIP-712 context for clear signing
          const eip712Provider = authWitnessProvider as Eip712AuthWitnessProvider | null;
          const isEip712 = eip712Provider?.setPendingTxContext;

          if (isEip712) {
            try {
              // Build EIP-712 context for the view function call
              const callInput = await buildFunctionCallInput(
                contractAddress,
                artifact,
                String(functionName),
                args as unknown[]
              );

              const txNonce = generateRandomTxNonce();

              console.log('[useReadContract] Setting EIP-712 context for view function:', {
                functionName: String(functionName),
                functionSignature: callInput.functionSignature,
                isPublic: callInput.isPublic,
                txNonce: txNonce.toString(),
              });

              eip712Provider.setPendingTxContext({
                calls: [callInput],
                txNonce,
              });
            } catch (contextErr) {
              console.warn('[useReadContract] Failed to set EIP-712 context:', contextErr);
              // Continue without EIP-712 - will fall back to personal_sign
            }
          }

          try {
            const result = await method(...(args as unknown[])).simulate({
              from: account.getAddress(),
            });

            return {
              success: true,
              data: result as TResult,
            };
          } finally {
            // Always clear EIP-712 context
            if (isEip712 && eip712Provider?.clearPendingTxContext) {
              eip712Provider.clearPendingTxContext();
            }
          }
        }

        const errorMsg = 'Unknown wallet type';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        setIsPending(false);
      }
    },
    [connector, account, currentConfig, authWitnessProvider]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsPending(false);
  }, []);

  return {
    readContract,
    isPending,
    error,
    reset,
  };
};
