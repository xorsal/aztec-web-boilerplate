/**
 * Unit tests for EIP-712 Helper Utilities
 *
 * These tests verify that function signatures are correctly built from real contract artifacts.
 */

import { describe, it, expect } from 'vitest';
import { loadContractArtifact } from '@aztec/aztec.js/abi';
import {
  buildFunctionSignature,
  buildFunctionCallInput,
  findFunctionArtifact,
  noirTypeToString,
  argsToFields,
} from '../../src/utils/eip712-helpers';

// Import real contract artifacts
import DripperJson from '../../src/target/dripper-Dripper.json';

describe('EIP-712 Helpers', () => {
  const DripperArtifact = loadContractArtifact(DripperJson as any);

  describe('noirTypeToString', () => {
    it('should convert Field type', () => {
      const param = { name: 'test', type: { kind: 'field' as const }, visibility: 'public' as const };
      expect(noirTypeToString(param)).toBe('Field');
    });

    it('should convert unsigned integer types', () => {
      const u64 = { name: 'test', type: { kind: 'integer' as const, sign: 'unsigned' as const, width: 64 }, visibility: 'public' as const };
      const u128 = { name: 'test', type: { kind: 'integer' as const, sign: 'unsigned' as const, width: 128 }, visibility: 'public' as const };
      expect(noirTypeToString(u64)).toBe('u64');
      expect(noirTypeToString(u128)).toBe('u128');
    });

    it('should convert signed integer types', () => {
      const i32 = { name: 'test', type: { kind: 'integer' as const, sign: 'signed' as const, width: 32 }, visibility: 'public' as const };
      expect(noirTypeToString(i32)).toBe('i32');
    });

    it('should convert struct types to short name', () => {
      const aztecAddress = {
        name: 'test',
        type: {
          kind: 'struct' as const,
          path: 'aztec::protocol_types::address::aztec_address::AztecAddress',
          fields: [],
        },
        visibility: 'public' as const,
      };
      expect(noirTypeToString(aztecAddress)).toBe('AztecAddress');
    });

    it('should convert boolean type', () => {
      const bool = { name: 'test', type: { kind: 'boolean' as const }, visibility: 'public' as const };
      expect(noirTypeToString(bool)).toBe('bool');
    });
  });

  describe('buildFunctionSignature with real artifacts', () => {
    it('should build correct signature for drip_to_private', () => {
      const func = findFunctionArtifact(DripperArtifact, 'drip_to_private');
      expect(func).toBeDefined();

      const signature = buildFunctionSignature(func!);
      // AztecAddress struct is expanded to its fields (Field)
      // This matches Aztec SDK's FunctionSignatureDecoder behavior
      expect(signature).toBe('drip_to_private((Field),u64)');
    });

    it('should build correct signature for sync_private_state', () => {
      const func = findFunctionArtifact(DripperArtifact, 'sync_private_state');
      expect(func).toBeDefined();

      const signature = buildFunctionSignature(func!);
      // sync_private_state has no parameters
      expect(signature).toBe('sync_private_state()');
    });
  });

  describe('buildFunctionCallInput', () => {
    it('should build FunctionCallInput for drip_to_private', async () => {
      const tokenAddress = 123456789n;
      const amount = 1000n;

      const callInput = await buildFunctionCallInput(
        tokenAddress,
        DripperArtifact,
        'drip_to_private',
        [{ toBigInt: () => tokenAddress }, amount]
      );

      expect(callInput.targetAddress).toBe(tokenAddress);
      // AztecAddress struct is expanded to its fields (Field)
      expect(callInput.functionSignature).toBe('drip_to_private((Field),u64)');
      expect(callInput.args).toHaveLength(2);
      expect(callInput.args[0]).toBe(tokenAddress);
      expect(callInput.args[1]).toBe(amount);
    });

    it('should throw for non-existent method', async () => {
      await expect(
        buildFunctionCallInput(0n, DripperArtifact, 'nonexistent_method', [])
      ).rejects.toThrow('Method nonexistent_method not found');
    });
  });

  describe('argsToFields', () => {
    it('should convert various types to bigint', () => {
      const args = [
        123n,           // bigint
        456,            // number
        true,           // boolean
        '789',          // string number
        '0xabc',        // hex string
        { toBigInt: () => 999n }, // Fr-like
      ];

      const fields = argsToFields(args);

      expect(fields).toEqual([123n, 456n, 1n, 789n, 0xabcn, 999n]);
    });

    it('should handle AztecAddress-like objects', () => {
      const aztecAddress = {
        toField: () => ({ toBigInt: () => 12345n }),
      };

      const fields = argsToFields([aztecAddress]);
      expect(fields).toEqual([12345n]);
    });
  });
});
