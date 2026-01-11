# Old Notes (Deprecated)

**Source**: https://www.notion.so/2d89a4c092c780d4aac4fc49266d138c

## Option 1: Account contract changes only

Without counting on other developer's collaboration, the only data available pertaining the...

## Option 2: helper-wide changes

In both cases, `message` will take the following (constrained) form:

```rust
struct AztecAuthorization {
  AppDomain appDomain,
  T message, // T is gonna be defined by the frontend or app (opt. 1 or 2 resp.)
}

struct AppDomain {
  string name, // of the dApp
  string version, // of the dApp
  // chainId is already implicit in the actual eip712Domain
  AztecAddress verifyingContract, // of the dApp xd
  bytes32 salt,
}
```

The `verifyingContract` field will automatically be assigned `self.context.msg_sender()`.

For a default `assert_current_call_valid_authwit`, `message` will further be specialized to something like this:

```rust
struct {FunctionName} {
  ArgType1 arg1,
  ArgType2 arg2,
  ...
}
```

E.g., for `transfer_private_to_private`, it will look like this:

```rust
struct TransferPrivateToPrivate {
  AztecAddress from,
  AztecAddress to,
  uint128 amount,
  Field nonce,
}
```

This should be macro'd as much as possible, so that the developer doesn't have to even know of EIP-712.

## The `entrypoint` dilemma

Making `entrypoint` clearer is a whole different beast, because *conceptually* (which is what we want in the EIP-712 message), the called apps and functions are variable.

In order to make `entrypoint` authorizations EIP-712-compatible, we'd need to work our way around this with comptime known stuff and use recursion to deal with runtime-dependent stuff.

**Notes** (to check):

- `keccak256` allows to hash up to a point *before* total message length `N`
- The encoding of a struct instance is `enc(value_1) || ... enc(value_n)`

So we could encode each call in the `entrypoint` just the same and feed the variable-length arguments through an oracle call that takes in the number of argument (less than some constant `MAX_ENTRYPOINT_ARGUMENTS`) and uses trailing zeroes. But the struct itself could look just the same as above, which would be plenty nice.

**TODO**:

- [ ] Think about these workarounds. Still, this is Ethereum-wallet-compatible-account-contract-specific issue, as other wallets can display all the info anyways. If we just EIP-712 the current hash (just like it's already done), it's solved yay! except the user doesn't know what the fuck they're calling within, but they can be sure they're calling *something*, and the other contracts will make sure to ask for readable stuff if they follow this standard.
- [ ] How come sponsored transactions are opaque? they're using entrypoint and setup, *are they not*?

## Technical dive

### Aztec types to EIP-712 types

In order for Aztec structs to represent valid EIP-712 structs, we need to perform a mapping between them and their types, where EIP-712's chosen types should be able to contain all the info of their counterpart.

The list of Noir native types is taken from [here](https://noir-lang.org/docs/noir/concepts/data_types).

The following mappings are defined and make sense:

| Noir Type | EIP-712 Type | Rationale |
|-----------|--------------|-----------|
| `Field` | `struct Field { uint256 value }` | Avoids **all** ambiguity. Using `uint256` or `bytes32` would lead the user to think such types exist. The later would further suggest that you're not dealing with an arithmetic type (which you are). |
| `u8`-`u128` / `i8`-`i128` | `uint8`-`uint256` / `int8`-`int256` | Direct mapping |
| `bool` | `bool` | Direct mapping |
| `str<N>` | `string` | Direct mapping |
| `[Type; Size]` | `Type[Size]` | Direct mapping |
| `struct` | `struct` | Only if all elements are mappable |
| `AztecAddress` | As struct | Maps as struct |

**Not supported** (no EIP-712 equivalent or no incentive):

- Slices - No equivalent in EIP-712 (as they reference other data) and don't show a clear incentive to use either
- Tuples - No equivalent in EIP-712 *and* they lack the semantic information in their data types to be clear. The use of structs (which have a name, and named elements) is encouraged instead
- References - No equivalent in EIP-712 nor incentive
- Function types - No equivalent

### Aztec-side modifications

**TODO**:

- [ ] See how to extract function metadata at comptime, see if we can then turn `assert_current_call_valid_authwit` into a `comptime` so that devs don't need to stress themselves w/ this
