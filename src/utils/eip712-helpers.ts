/**
 * EIP-712 Helper Utilities
 *
 * Helper functions for building EIP-712 transaction context from contract interactions.
 */

import type { ContractArtifact, FunctionArtifact, ABIParameter } from '@aztec/aztec.js/abi';
import type { AztecAddress, Fr } from '@aztec/aztec.js';
import type { FunctionCallInput } from '../lib/eip712';

/**
 * Convert a Noir type to a human-readable type string for function signatures.
 *
 * @param param - The ABI parameter
 * @returns Human-readable type string
 */
export function noirTypeToString(param: ABIParameter): string {
  const { type } = param;

  // Handle basic types
  if (typeof type === 'string') {
    return type;
  }

  // Handle structured types
  switch (type.kind) {
    case 'field':
      return 'Field';
    case 'integer':
      return type.sign === 'unsigned' ? `u${type.width}` : `i${type.width}`;
    case 'boolean':
      return 'bool';
    case 'string':
      return 'str';
    case 'array':
      // For arrays, recursively convert the element type
      const elementType = noirTypeToString({ name: '', type: type.type, visibility: 'public' });
      return `[${elementType}; ${type.length}]`;
    case 'struct':
      // For structs, just use the struct name
      return type.path.split('::').pop() || 'Struct';
    default:
      return 'Field'; // Default fallback
  }
}

/**
 * Build a function signature string from a function artifact.
 *
 * @param func - The function artifact from the contract
 * @returns Function signature string (e.g., "transfer_private(Field,Field,u128,Field)")
 */
export function buildFunctionSignature(func: FunctionArtifact): string {
  const params = func.parameters.map(noirTypeToString).join(',');
  return `${func.name}(${params})`;
}

/**
 * Find a function artifact by name from a contract artifact.
 *
 * @param artifact - The contract artifact
 * @param methodName - The method name to find
 * @returns The function artifact or undefined
 */
export function findFunctionArtifact(
  artifact: ContractArtifact,
  methodName: string
): FunctionArtifact | undefined {
  return artifact.functions.find((f) => f.name === methodName);
}

/**
 * Convert various argument types to bigint for EIP-712 encoding.
 *
 * @param arg - The argument to convert
 * @returns The argument as bigint
 */
export function argToField(arg: unknown): bigint {
  if (typeof arg === 'bigint') {
    return arg;
  }
  if (typeof arg === 'number') {
    return BigInt(arg);
  }
  if (typeof arg === 'boolean') {
    return arg ? 1n : 0n;
  }
  if (typeof arg === 'string') {
    // Handle hex strings
    if (arg.startsWith('0x')) {
      return BigInt(arg);
    }
    // Try to parse as number
    return BigInt(arg);
  }
  // Handle Fr-like objects
  if (arg && typeof arg === 'object' && 'toBigInt' in arg) {
    return (arg as { toBigInt: () => bigint }).toBigInt();
  }
  // Handle AztecAddress-like objects
  if (arg && typeof arg === 'object' && 'toField' in arg) {
    const field = (arg as { toField: () => { toBigInt: () => bigint } }).toField();
    return field.toBigInt();
  }

  throw new Error(`Cannot convert ${typeof arg} to field: ${String(arg)}`);
}

/**
 * Convert an array of arguments to bigint fields.
 *
 * @param args - The arguments to convert
 * @returns Array of bigint fields
 */
export function argsToFields(args: unknown[]): bigint[] {
  return args.map(argToField);
}

/**
 * Build a FunctionCallInput from contract interaction parameters.
 *
 * @param targetAddress - The contract address
 * @param artifact - The contract artifact
 * @param methodName - The method name
 * @param args - The method arguments
 * @returns FunctionCallInput for EIP-712 context
 */
export function buildFunctionCallInput(
  targetAddress: AztecAddress | bigint | string,
  artifact: ContractArtifact,
  methodName: string,
  args: unknown[]
): FunctionCallInput {
  // Find the function in the artifact
  const func = findFunctionArtifact(artifact, methodName);
  if (!func) {
    throw new Error(`Method ${methodName} not found in contract artifact`);
  }

  // Build the function signature
  const functionSignature = buildFunctionSignature(func);

  // Convert address to bigint
  let addressBigInt: bigint;
  if (typeof targetAddress === 'bigint') {
    addressBigInt = targetAddress;
  } else if (typeof targetAddress === 'string') {
    addressBigInt = BigInt(targetAddress);
  } else {
    // AztecAddress
    addressBigInt = (targetAddress as { toBigInt: () => bigint }).toBigInt();
  }

  // Convert arguments to fields
  const fieldArgs = argsToFields(args);

  return {
    targetAddress: addressBigInt,
    functionSignature,
    args: fieldArgs,
  };
}

/**
 * Build multiple FunctionCallInputs for a batched transaction.
 *
 * @param calls - Array of call parameters
 * @returns Array of FunctionCallInputs
 */
export function buildFunctionCallInputs(
  calls: Array<{
    targetAddress: AztecAddress | bigint | string;
    artifact: ContractArtifact;
    methodName: string;
    args: unknown[];
  }>
): FunctionCallInput[] {
  return calls.map((call) =>
    buildFunctionCallInput(
      call.targetAddress,
      call.artifact,
      call.methodName,
      call.args
    )
  );
}
