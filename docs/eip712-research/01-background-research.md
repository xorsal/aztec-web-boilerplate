# EIP-712 Aztec Background Research

**Source**: https://www.notion.so/2d19a4c092c7808895e8db86da5c90c5

## Authwit quick recap

### Noir side

The canonical flow to define how an account does authorization is to use [`AccountActions`](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/noir-projects/aztec-nr/aztec/src/authwit/account.nr#L10-L13)'s default `entrypoint` and `verify_private_authwit` functions. To do so, the account implements their own version of `is_valid_impl: fn(&mut PrivateContext, Field) -> bool`, which takes a context and an `outer_hash` field element as input, and returns whether a valid authorization has been fed via oracle for the "outer hash".

Contracts like the token will [use](https://github.com/defi-wonderland/aztec-standards/blob/1ae323c9601148fb9db79c207bcb85fa1c49b4fd/src/token_contract/src/main.nr#L829) the [`assert_current_call_valid_authwit`](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/noir-projects/aztec-nr/aztec/src/authwit/auth.nr#L257-L274) helper to ask for confirmation of the current function call (e.g. `transfer`) on behalf of the user. This helper will then:

1. Hash the following together to produce the `inner_hash`:
   - `msg_sender`: the contract that's asking for the authwit
   - `selector`: the function selector
   - `args_hash`: the hash of the private arguments to said function
2. Privately emit all the previous information through a call to `emit_authorization_as_offchain_effect`, as well as the plaintext for the function arguments. This in turn uses the `emit_offchain_effect` oracle call which *takes arbitrary serializable data* as input.
3. Call `verify_private_authwit` with the inner hash, which in turn will
   1. Compute the final `outer_hash` as the hash of:
      - `msg_sender`
      - `chain_id`
      - `version`
      - `inner_hash`
   2. Call `is_valid_impl` with such outer hash

### TS side

The typical approach for account contracts in TS is to extend [`DefaultAccountContract`](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/yarn-project/accounts/src/defaults/account_contract.ts#L11) by developing an [`AuthWitnessProvider`](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/yarn-project/entrypoints/src/interfaces.ts#L47-L54) and the [`getInitializationFunctionParameters`](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/yarn-project/accounts/src/defaults/account_contract.ts#L13-L21) function ([example](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/yarn-project/accounts/src/schnorr/account_contract.ts)). The `DefaultAccountContract` takes care to implement the [`EntrypointInterface`](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/yarn-project/entrypoints/src/interfaces.ts#L31), which deals with the creation of a TX for initialization, with the [`DefaultAccountEntrypoint`](https://github.com/AztecProtocol/aztec-packages/blob/v3.0.0-nightly.20251216/yarn-project/entrypoints/src/account_entrypoint.ts#L58).

**Issue**: these interfaces only transport the `outer_hash`, which is unreadable, even though offchain effects contain more readable information (the calling contract and the exact function call that's being authorized).

## EIP-712

[This EIP](https://eips.ethereum.org/EIPS/eip-712) solves the issue of hard-to-read messages by:

1. Defining an unambiguous way to serialize structs (that are composed of stuff, including possibly other structs), commit to them, and finally sign them
2. Introducing the `eth_signTypedData` JSON RPC (and corresponding Web3 API) to ask for the signature of such struct

This is the typed data that it defines:

- **Struct**, defined as
  - Identifier
  - List of member variables, each of which is defined as a pair of
    - Type
    - Name
- **Atomic types**, fixed-size simple types that can act as building blocks
  - `bytes1` to `bytes32`
  - `uint8` to `uint256`
  - `int8` to `int256`
  - `bool`
  - `address`
- **Dynamic types**, with arbitrary-length data
  - `bytes`
  - `string`
- **Reference types**
  - Arrays
  - Structs

And this is the `eip712DomainSeparator` that it makes available:

- `string name`: name of DApp
- `string version`: version of DApp
- `uint256 chainId`: EIP-155 chain ID. According to the specification, "The user-agent *should* refuse signing if it does not match the currently active chain."
- `address verifyingContract`: the contract that should do the verifying
- `bytes32 salt`: salt

The EIP-712 defines the payload to sign as:

```rust
encode(domain_separator, message) = "\x19\x01" || domainSeparator || hashStruct(message)
hashStruct(s) = keccak256(typeHash(s) || encodeData(s))
typeHash(s) = keccak256(encodeType(typeOf(s)))
domain_separator = hashStruct(eip712Domain)
```

Where `encodeType` is an encoding of the struct's definition, and `encodeData` is a complete specification of how to encode the data contained in the types defined above.

## (Im)possible work ahead

### On the Metamask-driven Aztec wallet

We have a ¿working? version of that [here](https://github.com/defi-wonderland/aztec-web-boilerplate/blob/89a48596e798922993e4b929cead9fa7f397b81a/contracts/ecdsa_k_eth_signer_account/src/main.nr). It does an EIP-712 request to MetaMask to sign the following:

```rust
struct {
  bytes32 outerHash,
  bytes32 targetContract,
  string functionSignature,
  bytes32 argsHash,
  uint256 nonce
};
```

But:
- `functionSignature` is hardcoded as the wallet's constructor's signature
- There aren't visible *arguments*
- Why does it include a nonce?

**Question**: Taking into account that simulations can deliver the whole function call (whenever target contract's artifacts are available), could we present each authwit's arguments in plaintext for the user to sign?

**Answer**: Technically yes, but not practically.

**Why**: In order for the signature to serve as an authwit, the account contract's Noir code must be able to verify the signature against the constrained definition.

Aztec's smart contracts usually call `assert_current_call_valid_authwit(context: &mut PrivateContext, on_behalf_of: AztecAddress)`. The function then takes care to extract *binding information* from the context in order to produce the `inner_hash`. The context doesn't have artifact data, so it could not feed it into circuits further down.

We could expect other contracts to *feed* the properly-formatted data to the authwit assertion function, i.e., pass the EIP-712 *encoding* of their function call data to some "assert valid authwit" function (instead of just passing the context and authorizer address). This assert function (which is part of Aztec's standard) should then prepend the proper EIP712 domain separator, which would make `outer_hash` a 64-bytes element for the `is_valid_impl` to check. This would require:

- Modifying Aztec's own way of computing `outer_hash`
- Replacing the assertion helper function with a macro that does the EIP-712 encoding
- Re-adapting every existing wallet to verify this `outer_hash` instead

And it would increase proving costs in order to constrain the EIP712 `hashStruct` computation.
