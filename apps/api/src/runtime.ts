/**
 * Runtime prerequisites. The Minds SDK (`@animocabrands/minds-client-lib`)
 * requires Node >= 22, so the API fails fast with a clear message instead of
 * failing mysteriously at the first provider call.
 */
export const MIN_NODE_VERSION = '22.0.0'

/** True when `version` is at least `min` (semver-ish compare on numeric parts). */
export function isSupportedNodeVersion(version: string, min: string = MIN_NODE_VERSION): boolean {
  // Compare numeric parts only; pre-release suffixes (e.g. "22.0.0-rc.1")
  // still count as the base version.
  const parts = version.split('.').map((p) => Number(p.match(/^\d+/)?.[0] ?? 0))
  const minParts = min.split('.').map((p) => Number(p.match(/^\d+/)?.[0] ?? 0))
  for (let i = 0; i < Math.max(parts.length, minParts.length); i++) {
    const part = parts[i] ?? 0
    const minPart = minParts[i] ?? 0
    if (part !== minPart) return part > minPart
  }
  return true
}

/**
 * Fails startup when the running Node is older than required. Only the
 * version numbers are reported — never environment details or secrets.
 */
export function assertSupportedNodeVersion(
  version: string = process.versions.node,
  min: string = MIN_NODE_VERSION,
): void {
  if (!isSupportedNodeVersion(version, min)) {
    throw new Error(
      `Node.js ${version} is not supported — LINKUP requires Node.js >= ${min} (the Minds provider SDK requires it).`,
    )
  }
}
