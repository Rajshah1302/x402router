/**
 * Enhanced Access Control role bitmaps.
 *
 * EAC packs 32 roles into the low 128 bits of a `uint256`, one nybble each,
 * with the matching admin role 128 bits higher. A role is always granted
 * against a *resource* — a specific name, or `ROOT_RESOURCE` (0) meaning
 * "everything in this contract".
 *
 * Mirrors `RegistryRolesLib` and `PermissionedResolverLib` in
 * ensdomains/contracts-v2. Only the roles Router402 grants are reproduced.
 */

/** The contract-wide resource. Holding a role here is the master key. */
export const ROOT_RESOURCE = 0n;

/** Roles on a `PermissionedRegistry` (`RegistryRolesLib`). */
export const RegistryRoles = {
  /** Register new labels. Root-scoped only. */
  REGISTRAR: 1n << 0n,
  /** Delete a label — this is how a session is revoked. Root or token. */
  UNREGISTER: 1n << 12n,
  /** Extend expiry. Root or token. */
  RENEW: 1n << 16n,
  /** Repoint a label at a different child registry. Root or token. */
  SET_SUBREGISTRY: 1n << 20n,
  /** Repoint a label at a different resolver. Root or token. */
  SET_RESOLVER: 1n << 24n,
  /**
   * Permit ERC-1155 transfer of the name. Checked against the *current owner*.
   *
   * Router402 never grants this on a session name: that is what makes a
   * session key non-transferable. The name cannot be sold, lent or moved to
   * another address — it can only expire or be unregistered.
   */
  CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
  /** Authorize UUPS upgrades of the registry proxy. Root-only. */
  UPGRADE: 1n << 124n,
} as const;

/** Roles on a `PermissionedResolver` (`PermissionedResolverLib`). */
export const ResolverRoles = {
  SET_ADDR: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_NAME: 1n << 24n,
  SET_ALIAS: 1n << 28n,
  SET_DATA: 1n << 36n,
  UPGRADE: 1n << 124n,
} as const;

/** The admin counterpart of a role, which may grant and revoke it. */
export function adminOf(role: bigint): bigint {
  return role << 128n;
}

/** Combine roles into the single bitmap the EAC functions take. */
export function bitmap(...roles: bigint[]): bigint {
  return roles.reduce((acc, role) => acc | role, 0n);
}

/**
 * Roles Router402 grants itself on a registry proxy it owns: register names,
 * revoke them, extend them, and point them at resolvers — plus the admin half
 * of each, so it can delegate any of them later.
 */
export const REGISTRY_OPERATOR_ROLES = bitmap(
  RegistryRoles.REGISTRAR,
  adminOf(RegistryRoles.REGISTRAR),
  RegistryRoles.UNREGISTER,
  adminOf(RegistryRoles.UNREGISTER),
  RegistryRoles.RENEW,
  adminOf(RegistryRoles.RENEW),
  RegistryRoles.SET_SUBREGISTRY,
  adminOf(RegistryRoles.SET_SUBREGISTRY),
  RegistryRoles.SET_RESOLVER,
  adminOf(RegistryRoles.SET_RESOLVER),
  RegistryRoles.UPGRADE,
);

/** Roles Router402 grants itself on a resolver proxy it owns. */
export const RESOLVER_OPERATOR_ROLES = bitmap(
  ResolverRoles.SET_ADDR,
  adminOf(ResolverRoles.SET_ADDR),
  ResolverRoles.SET_TEXT,
  adminOf(ResolverRoles.SET_TEXT),
  ResolverRoles.SET_CONTENTHASH,
  adminOf(ResolverRoles.SET_CONTENTHASH),
  ResolverRoles.SET_ALIAS,
  adminOf(ResolverRoles.SET_ALIAS),
  ResolverRoles.UPGRADE,
);

/**
 * Roles carried by a session name's owner — the session key itself.
 *
 * Deliberately minimal, and deliberately *without* `CAN_TRANSFER_ADMIN`:
 *
 *   - `UNREGISTER` lets the holder of the session key burn its own session
 *     without asking the gateway. Revocation is not a favour the gateway does
 *     for you; the key can always end itself.
 *   - no `RENEW`, so a session cannot extend its own expiry.
 *   - no `SET_RESOLVER`, so it cannot repoint its records at a resolver that
 *     reports different caps.
 */
export const SESSION_OWNER_ROLES = bitmap(RegistryRoles.UNREGISTER);
