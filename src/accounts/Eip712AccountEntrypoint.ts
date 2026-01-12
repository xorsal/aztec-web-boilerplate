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
import { FunctionSelector, FunctionType, encodeArguments } from '@aztec/stdlib/abi';
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
 * Encoded function call for an Aztec entrypoint.
 *
 * IMPORTANT: encodeArguments expects PRIMITIVE values, not Fr objects.
 * The encoder will create Fr internally from the primitives.
 *
 * - args_hash: bigint (Field value)
 * - function_selector.value: number (u32) - NOTE: SDK encoder uses .value not .inner
 * - target_address.inner: bigint (Field value)
 */
interface EncodedFunctionCall {
  args_hash: bigint;                       // Field as bigint
  function_selector: { value: number };    // u32 as number - encoder uses .value
  target_address: { inner: bigint };       // Field as bigint
  is_public: boolean;
  hide_msg_sender: boolean;
  is_static: boolean;
}

/**
 * EncodedAppEntrypointCalls - simplified version matching SDK's encoding
 *
 * IMPORTANT: All field values passed to encodeArguments must be primitives (bigint),
 * not Fr objects. The encoder handles conversion internally.
 */
class EncodedAppEntrypointCalls {
  private constructor(
    public readonly hashedArguments: HashedValues[],
    private readonly encodedFunctionCalls: EncodedFunctionCall[],
    public readonly tx_nonce: bigint  // bigint for encodeArguments
  ) {}

  // Snake_case getter for Noir compatibility
  get function_calls(): EncodedFunctionCall[] {
    return this.encodedFunctionCalls;
  }

  static async create(calls: { to: AztecAddress; selector: FunctionSelector; args: Fr[]; isStatic: boolean; type?: string }[], txNonce?: Fr) {
    const nonce = txNonce ?? Fr.random();
    const hashedArguments: HashedValues[] = [];
    const encodedFunctionCalls: EncodedFunctionCall[] = [];

    // Process actual calls
    for (const call of calls) {
      const isPublic = call.type === FunctionType.PUBLIC;

      // For public functions, use fromCalldata (includes selector, PUBLIC_CALLDATA separator)
      // For private functions, use fromArgs (just args, FUNCTION_ARGS separator)
      //
      // Note: EIP-712 is only used for private functions (constrained).
      // Public functions use the standard entrypoint with personal_sign.
      const argsHashedValues = isPublic
        ? await HashedValues.fromCalldata([call.selector.toField(), ...call.args])
        : await HashedValues.fromArgs(call.args);

      hashedArguments.push(argsHashedValues);

      // All field values must be bigint for encodeArguments
      // NOTE: function_selector uses .value (not .inner) to match SDK's Selector class
      encodedFunctionCalls.push({
        args_hash: argsHashedValues.hash.toBigInt(),
        function_selector: { value: Number(call.selector.toField().toBigInt()) },  // u32 - .value for SDK encoder
        target_address: { inner: call.to.toField().toBigInt() },    // bigint
        is_public: isPublic,
        hide_msg_sender: false,
        is_static: call.isStatic,
      });
    }

    // Pad to 5 calls
    while (encodedFunctionCalls.length < 5) {
      const emptyHash = await HashedValues.fromArgs([]);
      hashedArguments.push(emptyHash);
      encodedFunctionCalls.push({
        args_hash: 0n,                         // bigint zero
        function_selector: { value: 0 },       // u32 zero - .value for SDK encoder
        target_address: { inner: 0n },         // bigint zero
        is_public: false,
        hide_msg_sender: false,
        is_static: false,
      });
    }

    return new EncodedAppEntrypointCalls(hashedArguments, encodedFunctionCalls, nonce.toBigInt());
  }

  /**
   * Serializes the function calls to an array of fields for hashing
   */
  private functionCallsToFields(): Fr[] {
    return this.encodedFunctionCalls.flatMap((call) => [
      new Fr(call.args_hash),                  // Convert bigint to Fr
      new Fr(call.function_selector.value),    // Convert u32 to Fr - .value to match SDK
      new Fr(call.target_address.inner),       // Convert bigint to Fr
      new Fr(call.is_public ? 1 : 0),
      new Fr(call.hide_msg_sender ? 1 : 0),
      new Fr(call.is_static ? 1 : 0),
    ]);
  }

  /**
   * Serializes the payload to an array of fields for hashing
   */
  toFields(): Fr[] {
    return [...this.functionCallsToFields(), new Fr(this.tx_nonce)];
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

    // CRITICAL: For EIP-712 entrypoint, we must use the same txNonce that was used for signing.
    // The pendingTxContext contains the nonce that was signed by the user in MetaMask.
    // If we use a different nonce here, signature verification will fail.
    let effectiveTxNonce = txNonce;
    if (useEip712Entrypoint && typeof eip712Provider.getPendingTxContext === 'function') {
      const pendingContext = eip712Provider.getPendingTxContext();
      if (pendingContext) {
        effectiveTxNonce = new Fr(pendingContext.txNonce);
        console.log('[Eip712AccountEntrypoint] Using txNonce from pendingContext:', {
          pendingTxNonce: pendingContext.txNonce.toString(),
          effectiveTxNonce: effectiveTxNonce.toString(),
          originalTxNonce: txNonce?.toString() ?? 'undefined',
        });
      }
    } else if (useEip712Entrypoint) {
      console.warn('[Eip712AccountEntrypoint] EIP-712 entrypoint selected but no pendingContext available!');
    }

    // Debug: Log the calls that will be encoded into AppPayload
    console.log('[Eip712AccountEntrypoint] SDK CALLS RAW:', {
      callCount: calls.length,
      calls: calls.map((call, i) => ({
        index: i,
        to_toString: call.to.toString(),
        to_toField: call.to.toField().toString(),
        to_toField_toBigInt: call.to.toField().toBigInt().toString(),
        to_toField_toHex: '0x' + call.to.toField().toBigInt().toString(16).padStart(64, '0'),
        selector: call.selector.toString(),
        argsCount: call.args.length,
      })),
    });

    // CRITICAL DEBUG: Compare capsule address vs AppPayload address for ALL calls
    if (useEip712Entrypoint && typeof eip712Provider.getPendingTxContext === 'function') {
      const pendingCtx = eip712Provider.getPendingTxContext();

      console.log('[Eip712AccountEntrypoint] CALL COUNTS:', {
        capsuleCallCount: pendingCtx?.calls.length ?? 0,
        sdkCallCount: calls.length,
        pendingCtxExists: !!pendingCtx,
      });

      if (pendingCtx && pendingCtx.calls.length > 0) {
        // Log ALL capsule addresses
        console.log('[Eip712AccountEntrypoint] CAPSULE CALLS:', pendingCtx.calls.map((c, i) => ({
          index: i,
          targetAddress: c.targetAddress.toString(),
          targetAddressHex: '0x' + c.targetAddress.toString(16).padStart(64, '0'),
          functionSignature: c.functionSignature,
        })));
      }

      if (calls.length > 0) {
        // Log ALL SDK calls
        console.log('[Eip712AccountEntrypoint] SDK CALLS ADDRESSES:', calls.map((c, i) => ({
          index: i,
          to: c.to.toField().toBigInt().toString(),
          toHex: '0x' + c.to.toField().toBigInt().toString(16).padStart(64, '0'),
          selector: c.selector.toString(),
        })));
      }

      // Compare each pair
      if (pendingCtx && pendingCtx.calls.length > 0 && calls.length > 0) {
        for (let i = 0; i < Math.min(pendingCtx.calls.length, calls.length); i++) {
          const capsuleAddr = pendingCtx.calls[i].targetAddress;
          const sdkAddr = calls[i].to.toField().toBigInt();

          console.log(`[Eip712AccountEntrypoint] COMPARE CALL ${i}:`, {
            capsule: capsuleAddr.toString(),
            sdk: sdkAddr.toString(),
            match: capsuleAddr === sdkAddr,
            capsuleHex: '0x' + capsuleAddr.toString(16).padStart(64, '0'),
            sdkHex: '0x' + sdkAddr.toString(16).padStart(64, '0'),
          });
        }
      }
    }

    // Encode the calls for the app
    const encodedCalls = await EncodedAppEntrypointCalls.create(
      calls.map((call) => ({
        to: call.to,
        selector: call.selector,
        args: call.args,
        isStatic: call.isStatic ?? false,
        type: call.type,  // CRITICAL: Pass function type for public/private distinction
      })),
      effectiveTxNonce
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

    // For EIP-712 entrypoint, get the capsule from the auth provider and include it
    // in the tx request. The capsule contains the signature and function call data.
    let allCapsules = [...capsules];
    if (useEip712Entrypoint && typeof eip712Provider.getCachedCapsule === 'function') {
      const eip712Capsule = eip712Provider.getCachedCapsule();
      if (eip712Capsule) {
        console.log('[Eip712AccountEntrypoint] Adding EIP-712 capsule to tx request:', {
          capsuleDataLength: eip712Capsule.data.length,
        });
        allCapsules.push(eip712Capsule);
      } else {
        console.warn('[Eip712AccountEntrypoint] EIP-712 entrypoint selected but no capsule available!');
      }
    }

    // Assemble the tx request
    const txRequest = TxExecutionRequest.from({
      firstCallArgsHash: entrypointHashedArgs.hash,
      origin: this.address,
      functionSelector: await FunctionSelector.fromNameAndParameters(abi.name, abi.parameters),
      txContext: new TxContext(this.chainId, this.version, gasSettings),
      argsOfCalls: [...encodedCalls.hashedArguments, entrypointHashedArgs, ...extraHashedArgs],
      authWitnesses: [...authWitnesses, appPayloadAuthwitness],
      capsules: allCapsules, // Include EIP-712 capsule if available
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
