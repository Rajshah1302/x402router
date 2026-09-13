/**
 * ENSv2 beta deployment on Sepolia.
 *
 * From https://docs.ens.domains/learn/deployments#sepolia-ensv2-beta, and
 * verified against live Sepolia on 2026-09-13: this set had 411 registrations
 * in the last ~30k blocks, the most recent four minutes before the check. It
 * is the deployment app.ens.dev writes to.
 *
 * **Do not take these from `ensdomains/contracts-v2@main`
 * `contracts/deployments/sepolia/`.** That directory is a *different*
 * deployment (artifact dated 2026-06-29) whose contracts are also live but
 * effectively idle — five registrations against this set's four hundred. The
 * beta is redeployed periodically and old sets are left standing, so "has
 * bytecode" proves nothing. Match the docs table, and confirm with recent
 * `LabelRegistered` activity before trusting any address here.
 *
 * The contracts are documented as *not final* before mainnet, so treat these
 * as pinned-to-a-beta, not permanent. Only the contracts Router402 touches are
 * listed. The two `Impl` entries are UUPS implementations: you never call them
 * directly, you deploy a proxy in front of them through the
 * `VerifiableFactory`.
 */
export const ENSV2_SEPOLIA = {
  /** Root of the v2 namespace; parent of `eth`. */
  rootRegistry: "0x8115186e8f2e0b0281e86ab91f0f48ba90364354",
  /** Registry holding every `*.eth` name. Our parent name lives here. */
  ethRegistry: "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2",
  /** ENSIP-10 read path: follows subregistries and applies aliasing. */
  universalResolver: "0x4a1817d13e9cf196f471725176355c1234b63c70",
  /** Deploys verifiable UUPS proxies of the two implementations below. */
  verifiableFactory: "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef",
  /** Implementation behind each registry proxy we deploy. */
  userRegistryImpl: "0x624a25d67b59d587752ebec8dded8827dae52050",
  /** Implementation behind each resolver proxy we deploy. */
  permissionedResolverImpl: "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e",
  /**
   * The test stablecoin `.eth` registration is priced in on this deployment.
   * Six decimals, and `mint(address,uint256)` is open to anyone — see
   * `scripts/mint-usdc.ts`. It is play money on Sepolia, unrelated to real USDC.
   */
  mockUsdc: "0x768f42455a2d082e23ceef7d51e5787c82d67a39",
} as const satisfies Record<string, `0x${string}`>;

export type EnsV2Addresses = typeof ENSV2_SEPOLIA;
