/**
 * Minimal ABIs for the ENSv2 contracts Router402 calls.
 *
 * ENSv2 has no published npm ABI package yet (`forge install ensdomains/
 * contracts-v2` is the documented route), so these are transcribed from the
 * interface sources at ensdomains/contracts-v2 @ main:
 *
 *   IStandardRegistry.sol, IPermissionedRegistry.sol, IRegistry.sol,
 *   IRegistryEvents.sol, IEnhancedAccessControl.sol,
 *   PermissionedResolver.sol, IVerifiableFactory.sol
 *
 * Only the members used here are included; adding one means checking it
 * against the same source.
 */

export const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "unregister",
    stateMutability: "nonpayable",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "renew",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "newExpiry", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setSubregistry",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "registry", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
  {
    // Status: 0 = AVAILABLE, 1 = RESERVED, 2 = REGISTERED.
    type: "function",
    name: "getState",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [
      {
        name: "state",
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "expiry", type: "uint64" },
          { name: "latestOwner", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "resource", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getResolver",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "resolver", type: "address" }],
  },
  {
    type: "function",
    name: "getSubregistry",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "registry", type: "address" }],
  },
  {
    type: "function",
    name: "hasRoles",
    stateMutability: "view",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "grantRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "grantRootRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rootAccount", type: "address" },
      { name: "roleBitmap", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "LabelRegistered",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "labelHash", type: "bytes32", indexed: true },
      { name: "label", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
      { name: "sender", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "LabelUnregistered",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
    ],
  },
] as const;

export const resolverAbi = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "admin", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "setters", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
      { name: "addressBytes", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAlias",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fromName", type: "bytes" },
      { name: "toName", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizeTextRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "toName", type: "bytes" },
      { name: "key", type: "string" },
      { name: "account", type: "address" },
      { name: "grant", type: "bool" },
    ],
    outputs: [{ name: "updated", type: "bool" }],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "", type: "bytes[]" }],
  },
] as const;

/** ENSIP-10 read path. Follows subregistries and applies resolver aliasing. */
export const universalResolverAbi = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "result", type: "bytes" },
      { name: "resolver", type: "address" },
    ],
  },
  {
    type: "function",
    name: "findExactRegistry",
    stateMutability: "view",
    inputs: [{ name: "name", type: "bytes" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "findOwner",
    stateMutability: "view",
    inputs: [{ name: "name", type: "bytes" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const verifiableFactoryAbi = [
  {
    type: "function",
    name: "deployProxy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "salt", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    type: "event",
    name: "ProxyDeployed",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "proxyAddress", type: "address", indexed: true },
      { name: "salt", type: "uint256", indexed: false },
      { name: "implementation", type: "address", indexed: false },
    ],
  },
] as const;
