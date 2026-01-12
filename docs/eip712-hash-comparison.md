# EIP-712 Hash Value Comparison

This document compares all cryptographic constants and hash computations between TypeScript and Noir.

## 1. Type Hashes

| Hash | TypeScript | Noir | Status |
|------|------------|------|--------|
| FUNCTION_CALL_TYPE_HASH | `0xaaa2c33266859fb1d325cc19a3d35fcb37d27eb1fd40785e8b2ca4d3dd2d23cb` | `0xaaa2c33266859fb1d325cc19a3d35fcb37d27eb1fd40785e8b2ca4d3dd2d23cb` | ✅ MATCH |
| APP_DOMAIN_TYPE_HASH | `0xca2212a93d16a0157ab9c731e0ce9d0ae0cb4571382c7bfe48f9af5d2cd4d9f7` | `0xca2212a93d16a0157ab9c731e0ce9d0ae0cb4571382c7bfe48f9af5d2cd4d9f7` | ✅ MATCH |
| ENTRYPOINT_AUTHORIZATION_5_TYPE_HASH | `0x09a26a7c859d874b9a4394c2c4346a55cac6704ad3d4509ff7a93cbbb55bcaf5` | `0x09a26a7c859d874b9a4394c2c4346a55cac6704ad3d4509ff7a93cbbb55bcaf5` | ✅ MATCH |

## 2. Pre-computed String Hashes

| Hash | TypeScript | Noir | Status |
|------|------------|------|--------|
| APP_DOMAIN_NAME_HASH (keccak256("EVM Aztec Wallet")) | `0x35e6e01869e84854dd0110c3f3338dda29499ea7e62e4338336555bee52ea8e9` | `0x35e6e01869e84854dd0110c3f3338dda29499ea7e62e4338336555bee52ea8e9` | ✅ MATCH |
| APP_DOMAIN_VERSION_HASH (keccak256("1.0.0")) | `0x06c015bd22b4c69690933c1058878ebdfef31f9aaae40bbe86d8a09fe1b2972c` | `0x06c015bd22b4c69690933c1058878ebdfef31f9aaae40bbe86d8a09fe1b2972c` | ✅ MATCH |
| DOMAIN_SEPARATOR | `0x0c4d2d20583d2ee0c940ac2789fd85e2758be2b7546e627efa99bab898e5a141` | `0x0c4d2d20583d2ee0c940ac2789fd85e2758be2b7546e627efa99bab898e5a141` | ✅ MATCH |

## 3. Empty Function Call Hash

| Hash | TypeScript | Noir | Status |
|------|------------|------|--------|
| EMPTY_FUNCTION_CALL_HASH | `0xfcc98508a78ba85fe14ceb88842fb8fdbfdf184f6b443415650597a419d9634b` | `0xfcc98508a78ba85fe14ceb88842fb8fdbfdf184f6b443415650597a419d9634b` | ✅ MATCH |

## 4. Unit Test Coverage Analysis

### Current Tests (eip712-encoder.test.ts)

| Test | What it checks | Gap |
|------|----------------|-----|
| `TYPE_HASHES should have all required type hashes` | Format only (regex) | ❌ Does NOT verify exact values match Noir |
| `should compute consistent function call hash` | Determinism | ❌ Does NOT verify matches Noir computation |
| `should compute app domain hash` | Format only | ❌ Does NOT verify matches Noir computation |
| `should compute domain separator with contract` | Format only | ❌ Does NOT verify matches Noir constant |

### Current Tests (eip712-account.test.ts)

| Test | What it checks | Gap |
|------|----------------|-----|
| `should sign empty call list` | Structure | ❌ Does NOT verify signature can be verified by Noir |
| `should sign single function call` | Structure | ❌ Does NOT verify signature can be verified by Noir |
| `createWitnessCapsule5` | Field count | ❌ Does NOT verify serialization matches Noir deserialization |

## 5. MISSING CRITICAL TESTS

### A. Type Hash Verification Tests
```typescript
// NEEDED: Verify TYPE_HASHES match Noir constants exactly
it('FUNCTION_CALL_TYPE_HASH should match Noir constant', () => {
  expect(TYPE_HASHES.FUNCTION_CALL).toBe(
    '0xaaa2c33266859fb1d325cc19a3d35fcb37d27eb1fd40785e8b2ca4d3dd2d23cb'
  );
});
```

### B. Domain Separator Verification
```typescript
// NEEDED: Verify domain separator matches Noir
it('domain separator should match Noir DOMAIN_SEPARATOR constant', () => {
  const separator = Eip712Encoder.computeDomainSeparatorWithContract(
    31337n,
    '0x0000000000000000000000000000000000000001'
  );
  expect(separator).toBe(
    '0x0c4d2d20583d2ee0c940ac2789fd85e2758be2b7546e627efa99bab898e5a141'
  );
});
```

### C. Empty Function Call Hash Verification
```typescript
// NEEDED: Verify empty function call hash matches Noir
it('empty function call hash should match Noir EMPTY_FUNCTION_CALL_HASH', () => {
  const hash = Eip712Encoder.hashFunctionCall(EMPTY_FUNCTION_CALL);
  expect(hash).toBe(
    '0xfcc98508a78ba85fe14ceb88842fb8fdbfdf184f6b443415650597a419d9634b'
  );
});
```

### D. Full Message Hash Verification
```typescript
// NEEDED: Test that the full message hash computation matches
it('should compute message hash that matches Noir computation', () => {
  // Create test data
  const call = Eip712Encoder.createFunctionCall(
    123n,
    'transfer(Field,u128)',
    [456n, 789n]
  );

  // Compute hashes
  const appDomainHash = Eip712Encoder.hashAppDomain(DEFAULT_APP_DOMAIN);
  const callHash = Eip712Encoder.hashFunctionCall(call);
  // ... etc

  // Verify against expected value (computed by Noir or reference implementation)
});
```

### E. End-to-End Signature Verification
```typescript
// NEEDED: Test that a signature created by TypeScript can be verified
it('signature should be verifiable by Noir algorithm', async () => {
  const account = new Eip712Account(TEST_PRIVATE_KEY);
  const call: FunctionCallInput = {
    targetAddress: 123n,
    functionSignature: 'transfer(Field,u128)',
    args: [456n, 789n],
  };

  // Sign
  const oracleData = await account.signEntrypoint5([call], 1n);

  // Manually verify the signature using the same algorithm Noir uses
  // 1. Recompute message hash
  // 2. Recompute payload
  // 3. Verify ECDSA signature recovers to correct public key
});
```

### F. Capsule Serialization/Deserialization Test
```typescript
// NEEDED: Verify capsule serialization matches Noir deserialization
it('capsule serialization should match Noir Eip712Witness5 deserialization', async () => {
  // Create capsule
  const capsule = await account.createWitnessCapsule5([call], 1n, contractAddress);

  // Manually deserialize using the same algorithm as Noir
  // Verify each field matches
});
```

## 6. FOUND BUG: Salt Serialization Truncation

### The Problem

The default salt is:
```
0x0000000000000000000000000000000000000000000000000000000000000001
```

This has a **non-zero last byte** (`0x01`).

**In TypeScript serialization** (`eip712-account.ts:349`):
```typescript
// [144]: salt (first 31 bytes)
fields.push(this.packBytes(data.salt, [31])[0]);  // Only 31 bytes!
```

**In Noir deserialization** (`eip712.nr:449-457`):
```noir
fn unpack_salt_from_field(field: Field) -> [u8; 32] {
    let mut salt: [u8; 32] = [0; 32];
    let bytes: [u8; 31] = field.to_be_bytes();
    for i in 0..31 {
        salt[i] = bytes[i];
    }
    // salt[31] stays 0  <-- ASSUMES last byte is 0!
    salt
}
```

### The Mismatch

| Step | Salt Value |
|------|------------|
| TypeScript SIGNS with | `0x...0001` (32 bytes, last byte = 0x01) |
| Capsule CONTAINS | `0x...0000` (31 bytes packed, last byte lost) |
| Noir COMPUTES with | `0x...0000` (unpacks to 32 bytes, last byte = 0x00) |

**Result**: Different message hashes → Signature verification fails!

### The Fix

Option A: Change salt to have zero last byte:
```typescript
salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
```

Option B: Fix serialization to preserve all 32 bytes (requires 2 fields instead of 1)

## 7. Files to Review

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/lib/eip712/eip712-encoder.ts` | Hash computations | `hashFunctionCall`, `hashAppDomain`, `hashEntrypointAuthorization5` |
| `src/lib/eip712/eip712-account.ts` | Signing & capsule creation | `signEntrypoint5`, `createWitnessCapsule5`, `serializeEip712Witness5` |
| `contracts/eip712_account/src/eip712.nr` | Noir hash functions | `hash_function_call`, `hash_app_domain`, `hash_entrypoint_authorization_5` |
| `contracts/eip712_account/src/main.nr` | Noir verification | `entrypoint5`, signature verification logic |
