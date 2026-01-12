import { useState, useCallback } from 'react';
import type { ContractArtifact } from '@aztec/aztec.js/abi';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Contract, type ContractBase } from '@aztec/aztec.js/contracts';
import {
  isBrowserWalletConnector,
  hasAppManagedPXE,
  isExternalSignerConnector,
} from '../../types/walletConnector';
import { waitForBrowserWalletReceipt } from '../../utils/txReceipt';
import { buildFunctionCallInput, isConstrainedFunction } from '../../utils/eip712-helpers';
import { useUniversalWallet } from '../context/useUniversalWallet';
import type {
  MethodsOf,
  ArgsOf,
  WriteContractResult,
} from '../../types/contractTypes';
import type { Eip712AuthWitnessProvider } from '../../accounts/Eip712AuthWitnessProvider';

/**
 * BN254 scalar field modulus (Fr modulus for Aztec's curve)
 * This is the maximum value that can be stored in an Fr field element.
 */
const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Get the appropriate artifact for a function.
 * Uses artifactForPublic for unconstrained public functions.
 */
function getArtifactForFunction(
  contract: { artifact: ContractArtifact; artifactForPublic?: ContractArtifact },
  functionName: string,
  isConstrained: boolean
): ContractArtifact {
  // For constrained functions, use the regular artifact
  if (isConstrained) {
    return contract.artifact;
  }

  // For unconstrained public functions, prefer artifactForPublic if available
  if (contract.artifactForPublic) {
    return contract.artifactForPublic;
  }

  // Fall back to regular artifact
  return contract.artifact;
}

/**
 * Generate a random txNonce for EIP-712 signing.
 * Must be unique per transaction to prevent replay attacks.
 * The nonce MUST be less than the Fr field modulus to avoid modular reduction
 * when converting to Fr, which would cause a mismatch between signed and verified values.
 */
function generateRandomTxNonce(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  // Convert to bigint
  let value = 0n;
  for (let i = 0; i < 32; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }

  // Reduce modulo FR_MODULUS to ensure it fits in an Fr field element
  // This ensures the same value is used for both signing and verification
  return value % FR_MODULUS;
}

interface UseWriteContractOptions {
  /** Timeout for transaction confirmation (ms) - used by embedded wallet */
  timeout?: number;
  /** Receipt polling options - used by browser wallet */
  receiptPolling?: {
    intervalMs?: number;
    maxAttempts?: number;
  };
}

/**
 * Type helper to extract contract type from a contract class.
 * Uses the static `at` method signature to infer the contract instance type.
 */
type ContractClassFor<TContract extends ContractBase> = {
  artifact: ContractArtifact;
  /** Optional artifact that includes public function bytecode */
  artifactForPublic?: ContractArtifact;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  at: (...args: any[]) => TContract;
};

interface WriteContractParams<
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

const getChainFromCaipAccount = (caipAccount: string): string => {
  const parts = caipAccount.split(':');
  return `${parts[0]}:${parts[1]}`;
};

/**
 * Hook for executing write operations on Aztec contracts.
 * Handles both embedded and browser wallet flows automatically.
 *
 * @example
 * ```tsx
 * const { writeContract, isPending } = useWriteContract();
 *
 * // TypeScript infers the method type from functionName
 * await writeContract({
 *   contract: DripperContract,
 *   address: dripperAddress,
 *   functionName: 'drip_to_private',
 *   args: [tokenAddress, 100n],
 * });
 * ```
 */
export const useWriteContract = (options: UseWriteContractOptions = {}) => {
  const { timeout = 900, receiptPolling } = options;
  const { connector, account, authWitnessProvider } = useUniversalWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writeContract = useCallback(
    async <
      TContract extends ContractBase,
      TMethod extends MethodsOf<TContract> = MethodsOf<TContract>,
    >(
      params: WriteContractParams<TContract, TMethod>
    ): Promise<WriteContractResult> => {
      const { contract, address, functionName, args } = params;

      if (!connector || !account) {
        return { success: false, error: 'Wallet not connected' };
      }

      // Determine if this is a constrained (private) function
      // We need to know this to select the right artifact
      const isConstrained = isConstrainedFunction(contract.artifact, String(functionName));

      // Select the appropriate artifact - use artifactForPublic for unconstrained public functions
      const artifact = getArtifactForFunction(contract, String(functionName), isConstrained);

      console.log('[useWriteContract] Artifact selection:', {
        functionName: String(functionName),
        isConstrained,
        usingArtifactForPublic: artifact !== contract.artifact,
      });

      setIsPending(true);
      setError(null);

      try {
        if (isBrowserWalletConnector(connector)) {
          const response = await connector.sendTransaction({
            actions: [
              {
                contract: address,
                method: String(functionName),
                args: (args as unknown[]).map((arg) =>
                  typeof arg === 'bigint' ? arg.toString() : arg
                ),
              },
            ],
          });

          if (response.status !== 'success') {
            const errorMsg = response.error ?? 'Transaction failed';
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          const caipAccount = connector.getCaipAccount();
          if (!caipAccount || !response.txHash) {
            return {
              success: true,
              txHash: response.txHash,
              data: response.rawResult,
            };
          }

          const chain = getChainFromCaipAccount(caipAccount);
          const receiptResult = await waitForBrowserWalletReceipt(
            connector,
            response.txHash,
            chain,
            receiptPolling
          );

          if (receiptResult.success === false) {
            setError(receiptResult.error);
            return {
              success: false,
              error: receiptResult.error,
              txHash: response.txHash,
            };
          }

          return {
            success: true,
            txHash: response.txHash,
            data: response.rawResult,
          };
        }

        // Handle both Embedded and External Signer connectors (both have app-managed PXE)
        if (hasAppManagedPXE(connector)) {
          const wallet = connector.getWallet();
          if (!wallet) {
            const errorMsg = 'Wallet instance not available';
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          const paymentMethod = await connector.getSponsoredFeePaymentMethod();
          const contractAddress = AztecAddress.fromString(address);

          // Create contract instance
          const contract = await Contract.at(contractAddress, artifact, wallet);

          // Get the method and call it
          const method = (
            contract as unknown as {
              methods: Record<string, (...args: unknown[]) => unknown>;
            }
          ).methods[String(functionName)];

          if (!method) {
            const errorMsg = `Method ${String(functionName)} not found on contract`;
            setError(errorMsg);
            return { success: false, error: errorMsg };
          }

          const tx = method(...(args as unknown[]));

          // Set EIP-712 context for External Signer wallets
          const eip712Provider = authWitnessProvider as Eip712AuthWitnessProvider | null;
          const isEip712 = isExternalSignerConnector(connector) && eip712Provider?.setPendingTxContext;

          console.log('[useWriteContract] EIP-712 check:', {
            connectorType: connector?.type,
            isExternalSigner: isExternalSignerConnector(connector),
            hasEip712Provider: !!eip712Provider,
            hasSetPendingTxContext: !!eip712Provider?.setPendingTxContext,
            isEip712,
          });

          if (isEip712 && isExternalSignerConnector(connector)) {
            // EIP-712 clear signing works for both private and public functions
            // The Noir contract uses the appropriate hash separator based on the is_public flag
            const isConstrained = isConstrainedFunction(artifact, String(functionName));
            console.log('[useWriteContract] Function check:', {
              functionName: String(functionName),
              isConstrained,
              isPublic: !isConstrained,
            });

            try {
              // Get the FPC (Fee Payment Contract) address from the sponsored fee payment method
              // The SDK adds an FPC call as the first call in the AppPayload, so we need to include it
              // in the EIP-712 typed data to match what the contract will verify.
              const feePaymentMethod = await connector.getSponsoredFeePaymentMethod();
              const fpcAddress = await feePaymentMethod.getFeePayer();

              console.log('[useWriteContract] FPC address:', fpcAddress.toString());

              // Build EIP-712 context with BOTH the FPC call AND the user's call
              // Order matters: FPC call comes first, then user call (same as SDK ordering)

              // FPC call: sponsor_unconditionally()
              // This is a PRIVATE function in the FPC contract, so isPublic: false
              const fpcCallInput = {
                targetAddress: fpcAddress.toField().toBigInt(),
                functionSignature: 'sponsor_unconditionally()',
                args: [] as bigint[],
                isPublic: false,  // FPC sponsor is a private function
              };

              // User's call
              const userCallInput = await buildFunctionCallInput(
                contractAddress,
                artifact,
                String(functionName),
                args as unknown[]
              );

              // Generate a unique random txNonce for this transaction.
              // This nonce is signed by the user and verified by the contract.
              // The Eip712AccountEntrypoint will use this same nonce for the AppPayload.
              const txNonce = generateRandomTxNonce();

              // Debug: Log the exact address values for comparison
              console.log('[useWriteContract] Address debug:', {
                inputAddress: address,
                contractAddressString: contractAddress.toString(),
                contractAddressToField: contractAddress.toField().toString(),
                contractAddressToFieldBigInt: contractAddress.toField().toBigInt().toString(),
                userCallTargetAddress: userCallInput.targetAddress.toString(),
                userCallTargetAddressHex: '0x' + userCallInput.targetAddress.toString(16).padStart(64, '0'),
                fpcAddressHex: '0x' + fpcCallInput.targetAddress.toString(16).padStart(64, '0'),
                argsConverted: userCallInput.args.map(a => a.toString()),
              });

              console.log('[useWriteContract] Setting EIP-712 context with FPC + user call:', {
                fpcFunction: fpcCallInput.functionSignature,
                fpcIsPublic: fpcCallInput.isPublic,
                userFunction: userCallInput.functionSignature,
                userIsPublic: userCallInput.isPublic,
                userSelector: userCallInput.selector?.toString(),
                userArgs: userCallInput.args.map(String),
                txNonce: txNonce.toString(),
              });

              // Include BOTH calls in the order SDK will construct them
              eip712Provider.setPendingTxContext({
                calls: [fpcCallInput, userCallInput],
                txNonce,
              });
            } catch (contextErr) {
              console.warn('[useWriteContract] Failed to set EIP-712 context:', contextErr);
              // Continue without EIP-712 - will fall back to personal_sign
            }
          }

          try {
            // Only simulate constrained functions - unconstrained public functions
            // are executed by the sequencer and don't need local simulation.
            // Attempting to simulate them fails because loadContractArtifact filters
            // out unconstrained functions from the artifact.
            if (isConstrained) {
              console.log(
                `[useWriteContract] Simulating ${String(functionName)}...`
              );
              try {
                // IMPORTANT: Pass paymentMethod to simulate() to match send() behavior
                // Without this, the SDK won't include the FPC call in the AppPayload during simulation,
                // causing a mismatch with our EIP-712 context which includes the FPC call
                const simulateResult = await (
                  tx as { simulate: (opts: unknown) => Promise<unknown> }
                ).simulate({
                  from: account.getAddress(),
                  fee: { paymentMethod },
                });
                console.log(
                  `[useWriteContract] Simulation successful:`,
                  simulateResult
                );
              } catch (simErr) {
                const simErrorMsg =
                  simErr instanceof Error ? simErr.message : 'Simulation failed';
                console.error(
                  `[useWriteContract] Simulation failed for ${String(functionName)}:`,
                  simErr
                );
                setError(simErrorMsg);
                return { success: false, error: `Simulation failed: ${simErrorMsg}` };
              }
            } else {
              console.log(
                `[useWriteContract] Skipping simulation for unconstrained public function ${String(functionName)}`
              );
            }

            console.log(`[useWriteContract] Sending ${String(functionName)}...`);

            const sentTx = (
              tx as {
                send: (opts: unknown) => {
                  wait: (opts: unknown) => Promise<unknown>;
                  getTxHash: () => Promise<unknown>;
                };
              }
            ).send({
              from: account.getAddress(),
              fee: { paymentMethod },
            });

            // Get transaction hash immediately after send
            try {
              const txHash = await sentTx.getTxHash();
              console.log(`[useWriteContract] Transaction hash:`, txHash?.toString());
            } catch (hashErr) {
              console.error(`[useWriteContract] Could not get tx hash:`, hashErr);
              if (hashErr instanceof Error) {
                console.error(`[useWriteContract] Error name:`, hashErr.name);
                console.error(`[useWriteContract] Error message:`, hashErr.message);
                console.error(`[useWriteContract] Error stack:`, hashErr.stack);
              }
            }

            console.log(`[useWriteContract] Waiting for transaction confirmation (timeout: ${timeout}s)...`);
            const result = await sentTx.wait({ timeout });
            console.log(`[useWriteContract] Transaction confirmed:`, result);

            return {
              success: true,
              data: result,
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
    [connector, account, timeout, authWitnessProvider]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsPending(false);
  }, []);

  return {
    writeContract,
    isPending,
    error,
    reset,
  };
};
