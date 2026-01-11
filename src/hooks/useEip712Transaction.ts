/**
 * useEip712Transaction - Hook for managing EIP-712 transaction context
 *
 * Provides a way to wrap transaction execution with EIP-712 context so that
 * MetaMask shows human-readable function names and arguments instead of raw hashes.
 *
 * Usage:
 * ```typescript
 * const { executeWithContext } = useEip712Transaction();
 *
 * await executeWithContext(
 *   {
 *     calls: [{
 *       targetAddress: tokenAddress.toBigInt(),
 *       functionSignature: 'transfer_private(Field,Field,u128,Field)',
 *       args: [from, to, amount, nonce]
 *     }],
 *     txNonce: await wallet.getTxNonce()
 *   },
 *   () => token.methods.transfer_private(from, to, amount).send().wait()
 * );
 * ```
 */

import { useCallback } from 'react';
import type { Eip712AuthWitnessProvider, PendingTxContext } from '../accounts/Eip712AuthWitnessProvider';

/**
 * Options for the useEip712Transaction hook
 */
export interface UseEip712TransactionOptions {
  /** The EIP-712 auth witness provider (from wallet services) */
  authWitnessProvider: Eip712AuthWitnessProvider | null;
}

/**
 * Return type for the useEip712Transaction hook
 */
export interface UseEip712TransactionReturn {
  /**
   * Execute a transaction with EIP-712 context.
   * This sets the pending context before execution and clears it after.
   *
   * @param context - The transaction context (function calls and nonce)
   * @param executor - The function that executes the transaction
   * @returns The result of the executor function
   */
  executeWithContext: <T>(
    context: PendingTxContext,
    executor: () => Promise<T>
  ) => Promise<T>;

  /**
   * Check if EIP-712 mode is available
   */
  isEip712Available: boolean;
}

/**
 * Hook for managing EIP-712 transaction context.
 *
 * This hook provides a wrapper function that sets the pending transaction
 * context before executing a transaction. This allows the EIP-712 auth
 * witness provider to show human-readable function calls in MetaMask.
 *
 * @param options - Hook options including the auth witness provider
 * @returns Object with executeWithContext function
 */
export function useEip712Transaction(
  options: UseEip712TransactionOptions
): UseEip712TransactionReturn {
  const { authWitnessProvider } = options;

  const executeWithContext = useCallback(
    async <T>(
      context: PendingTxContext,
      executor: () => Promise<T>
    ): Promise<T> => {
      // If no auth provider or not an EIP-712 provider, just execute directly
      if (!authWitnessProvider?.setPendingTxContext) {
        console.log('[EIP-712] No EIP-712 provider available, executing without context');
        return executor();
      }

      try {
        // Set the pending context before executing the transaction
        console.log('[EIP-712] Setting pending tx context:', {
          callCount: context.calls.length,
          txNonce: context.txNonce.toString(),
        });
        authWitnessProvider.setPendingTxContext(context);

        // Execute the transaction
        const result = await executor();

        return result;
      } finally {
        // Always clear the context, even if execution fails
        if (authWitnessProvider?.clearPendingTxContext) {
          console.log('[EIP-712] Clearing pending tx context');
          authWitnessProvider.clearPendingTxContext();
        }
      }
    },
    [authWitnessProvider]
  );

  return {
    executeWithContext,
    isEip712Available: !!authWitnessProvider?.setPendingTxContext,
  };
}

/**
 * Re-export types for convenience
 */
export type { PendingTxContext } from '../accounts/Eip712AuthWitnessProvider';
export type { FunctionCallInput } from '../lib/eip712';
