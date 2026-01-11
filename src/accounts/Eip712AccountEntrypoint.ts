/**
 * EIP-712 Account Entrypoint
 *
 * Dynamic entrypoint implementation that chooses between `entrypoint` and `entrypoint5`
 * based on whether EIP-712 context is available at transaction creation time.
 *
 * - `entrypoint`: Uses standard auth witness oracle (personal_sign fallback)
 * - `entrypoint5`: Uses capsule-based EIP-712 signatures
 *
 * This allows a single AccountInterface to be used for both:
 * 1. Account deployment (uses personal_sign → entrypoint)
 * 2. Regular transactions with EIP-712 (uses capsule → entrypoint5)
 */

import type { AuthWitnessProvider } from '@aztec/aztec.js/account';
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { EntrypointInterface } from '@aztec/entrypoints/interfaces';
import type { AccountFeePaymentMethodOptions } from '@aztec/entrypoints/account';
import { FunctionSelector, encodeArguments } from '@aztec/stdlib/abi';
import type { GasSettings } from '@aztec/stdlib/gas';
import { HashedValues, TxContext, TxExecutionRequest, type ExecutionPayload } from '@aztec/stdlib/tx';
import type { Eip712AuthWitnessProvider } from './Eip712AuthWitnessProvider';

// Constants from @aztec/entrypoints
const DEFAULT_CHAIN_ID = 31337;
const DEFAULT_VERSION = 1;

/**
 * Options for EIP-712 account entrypoint
 */
export interface Eip712AccountEntrypointOptions {
  /** Whether the transaction can be cancelled */
  cancellable?: boolean;
  /** A nonce to inject into the app payload of the transaction */
  txNonce?: Fr;
  /** Options that configure how the account contract behaves depending on the fee payment method */
  feePaymentMethodOptions: AccountFeePaymentMethodOptions;
}

/**
 * Encoded function call for an Aztec entrypoint (matches SDK's encoding.ts)
 */
interface EncodedFunctionCall {
  args_hash: Fr;
  function_selector: Fr;
  target_address: Fr;
  is_public: boolean;
  hide_msg_sender: boolean;
  is_static: boolean;
}

/**
 * EncodedAppEntrypointCalls - simplified version matching SDK's encoding
 */
class EncodedAppEntrypointCalls {
  private constructor(
    public readonly hashedArguments: HashedValues[],
    private readonly encodedFunctionCalls: EncodedFunctionCall[],
    public readonly tx_nonce: Fr
  ) {}

  // Snake_case getter for Noir compatibility
  get function_calls(): EncodedFunctionCall[] {
    return this.encodedFunctionCalls;
  }

  static async create(calls: { to: AztecAddress; selector: FunctionSelector; args: Fr[]; isStatic: boolean }[], txNonce?: Fr) {
    const nonce = txNonce ?? Fr.random();
    const hashedArguments: HashedValues[] = [];
    const encodedFunctionCalls: EncodedFunctionCall[] = [];

    // Process actual calls
    for (const call of calls) {
      const argsHash = await HashedValues.fromArgs(call.args);
      hashedArguments.push(argsHash);
      encodedFunctionCalls.push({
        args_hash: argsHash.hash,
        function_selector: call.selector.toField(),
        target_address: call.to.toField(),
        is_public: false,
        hide_msg_sender: false,
        is_static: call.isStatic,
      });
    }

    // Pad to 5 calls
    while (encodedFunctionCalls.length < 5) {
      const emptyHash = await HashedValues.fromArgs([]);
      hashedArguments.push(emptyHash);
      encodedFunctionCalls.push({
        args_hash: Fr.ZERO,
        function_selector: Fr.ZERO,
        target_address: Fr.ZERO,
        is_public: false,
        hide_msg_sender: false,
        is_static: false,
      });
    }

    return new EncodedAppEntrypointCalls(hashedArguments, encodedFunctionCalls, nonce);
  }

  /**
   * Serializes the function calls to an array of fields
   */
  private functionCallsToFields(): Fr[] {
    return this.encodedFunctionCalls.flatMap((call) => [
      call.args_hash,
      call.function_selector,
      call.target_address,
      new Fr(call.is_public ? 1 : 0),
      new Fr(call.hide_msg_sender ? 1 : 0),
      new Fr(call.is_static ? 1 : 0),
    ]);
  }

  /**
   * Serializes the payload to an array of fields
   */
  toFields(): Fr[] {
    return [...this.functionCallsToFields(), this.tx_nonce];
  }

  async hash(): Promise<Fr> {
    // Import poseidon2HashWithSeparator to match SDK's hashing
    const { poseidon2HashWithSeparator } = await import('@aztec/foundation/crypto/poseidon');
    const { GeneratorIndex } = await import('@aztec/constants');

    return poseidon2HashWithSeparator(this.toFields(), GeneratorIndex.SIGNATURE_PAYLOAD);
  }
}

/**
 * Dynamic entrypoint interface that chooses between `entrypoint` and `entrypoint5`
 * based on the auth witness provider's pending context.
 */
export class Eip712AccountEntrypoint implements EntrypointInterface {
  constructor(
    private address: AztecAddress,
    private auth: AuthWitnessProvider,
    private chainId: number = DEFAULT_CHAIN_ID,
    private version: number = DEFAULT_VERSION
  ) {}

  async createTxExecutionRequest(
    exec: ExecutionPayload,
    gasSettings: GasSettings,
    options: Eip712AccountEntrypointOptions
  ): Promise<TxExecutionRequest> {
    // Initial request with calls, authWitnesses and capsules
    const { calls, authWitnesses, capsules, extraHashedArgs } = exec;

    // Global tx options
    const { cancellable, txNonce, feePaymentMethodOptions } = options;

    // Check if EIP-712 context is available
    const eip712Provider = this.auth as Eip712AuthWitnessProvider;
    const useEip712Entrypoint =
      typeof eip712Provider.hasPendingTxContext === 'function' &&
      eip712Provider.hasPendingTxContext();

    // Select the appropriate entrypoint
    const entrypointName = useEip712Entrypoint ? 'entrypoint5' : 'entrypoint';

    // Encode the calls for the app
    const encodedCalls = await EncodedAppEntrypointCalls.create(
      calls.map((call) => ({
        to: call.to,
        selector: call.selector,
        args: call.args,
        isStatic: call.isStatic ?? false,
      })),
      txNonce
    );

    // Obtain the entrypoint hashed args, built from the app encoded calls and global options
    const abi = this.getEntrypointAbi(entrypointName);
    // Pass the encoded calls object which has function_calls and tx_nonce getters
    const entrypointHashedArgs = await HashedValues.fromArgs(
      encodeArguments(abi, [encodedCalls, feePaymentMethodOptions, !!cancellable])
    );

    // Generate the payload auth witness
    // For EIP-712: returns empty AuthWitness (signature delivered via capsule)
    // For fallback: returns 64-field AuthWitness (personal_sign signature)
    const appPayloadAuthwitness = await this.auth.createAuthWit(await encodedCalls.hash());

    // Assemble the tx request
    const txRequest = TxExecutionRequest.from({
      firstCallArgsHash: entrypointHashedArgs.hash,
      origin: this.address,
      functionSelector: await FunctionSelector.fromNameAndParameters(abi.name, abi.parameters),
      txContext: new TxContext(this.chainId, this.version, gasSettings),
      argsOfCalls: [...encodedCalls.hashedArguments, entrypointHashedArgs, ...extraHashedArgs],
      authWitnesses: [...authWitnesses, appPayloadAuthwitness],
      capsules, // Capsules are injected by the Eip712AuthWitnessProvider
      salt: Fr.random(),
    });

    return txRequest;
  }

  /**
   * Returns the ABI for the specified entrypoint
   * @param name - Either 'entrypoint' or 'entrypoint5'
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getEntrypointAbi(name: string): any {
    return {
      name, // Dynamic: 'entrypoint' or 'entrypoint5'
      isInitializer: false,
      functionType: 'private',
      isOnlySelf: false,
      isStatic: false,
      parameters: [
        {
          name: 'app_payload',
          type: {
            kind: 'struct',
            path: 'authwit::entrypoint::app::AppPayload',
            fields: [
              {
                name: 'function_calls',
                type: {
                  kind: 'array',
                  length: 5,
                  type: {
                    kind: 'struct',
                    path: 'authwit::entrypoint::function_call::FunctionCall',
                    fields: [
                      { name: 'args_hash', type: { kind: 'field' } },
                      {
                        name: 'function_selector',
                        type: {
                          kind: 'struct',
                          path: 'authwit::aztec::protocol_types::abis::function_selector::FunctionSelector',
                          fields: [{ name: 'inner', type: { kind: 'integer', sign: 'unsigned', width: 32 } }],
                        },
                      },
                      {
                        name: 'target_address',
                        type: {
                          kind: 'struct',
                          path: 'authwit::aztec::protocol_types::address::AztecAddress',
                          fields: [{ name: 'inner', type: { kind: 'field' } }],
                        },
                      },
                      { name: 'is_public', type: { kind: 'boolean' } },
                      { name: 'hide_msg_sender', type: { kind: 'boolean' } },
                      { name: 'is_static', type: { kind: 'boolean' } },
                    ],
                  },
                },
              },
              { name: 'tx_nonce', type: { kind: 'field' } },
            ],
          },
          visibility: 'public',
        },
        {
          name: 'fee_payment_method',
          type: { kind: 'integer', sign: 'unsigned', width: 8 },
          visibility: 'private',
        },
        {
          name: 'cancellable',
          type: { kind: 'boolean' },
          visibility: 'private',
        },
      ],
      returnTypes: [],
      errorTypes: {},
    };
  }
}
