/**
 * Parse and merge static HTTP headers configured for the OpenFGA backend.
 *
 * Used at two distinct sites in the module: the SDK call path
 * (`useOpenFGAClient` → `OpenFgaClient.baseOptions.headers`) and the Nitro
 * init plugin's raw `fetch()` model-deploy. Both must read the same parser
 * so a single `OPENFGA_HEADERS` env var produces identical wire behavior in
 * both phases.
 */

/**
 * Parse a comma-separated `Key: Value` string into a header map.
 *
 * Format chosen to mirror HTTP itself — the only failure mode is a value
 * that legitimately contains a comma, which is rare for the static auth
 * headers this is intended for. Operators with comma-bearing values can
 * set the header through the module's `headers` option in `nuxt.config.ts`
 * instead of the env var.
 *
 * Splitting rules:
 *   - Pairs are separated by `,`
 *   - Within a pair, only the **first** `:` delimits key from value
 *     (so values may themselves contain `:` — e.g. tracing identifiers)
 *   - Surrounding whitespace is trimmed from both key and value
 *   - Whitespace **inside** a value is preserved (e.g. `Bearer abc`)
 *   - Empty entries (trailing commas, double commas) are silently dropped
 *   - Entries with no colon or an empty key are dropped and reported via
 *     `onMalformed` with their position. Callers should log the index, not
 *     the entry: a malformed entry can be a fragment of a secret.
 */
export function parseHeaders(
  raw?: string,
  onMalformed?: (entry: string, index: number) => void,
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!raw) return result

  const trimmed = raw.trim()
  if (!trimmed) return result

  for (const [index, rawEntry] of trimmed.split(',').entries()) {
    const entry = rawEntry.trim()
    if (!entry) continue

    const colonIdx = entry.indexOf(':')
    if (colonIdx === -1) {
      onMalformed?.(entry, index)
      continue
    }

    const key = entry.slice(0, colonIdx).trim()
    const value = entry.slice(colonIdx + 1).trim()
    if (!key) {
      onMalformed?.(entry, index)
      continue
    }

    result[key] = value
  }

  return result
}

/**
 * Read an OPENFGA_* env var, accepting either the bare form (`OPENFGA_X`)
 * or the Nuxt-config-override form (`NUXT_OPENFGA_X`). The NUXT_ form
 * wins on collision so operators using Nuxt's runtimeConfig override
 * convention get the expected precedence even when both are present.
 *
 * Pass the bare key — the helper prepends `NUXT_` itself.
 */
export function envValue(key: string): string | undefined {
  return process.env[`NUXT_${key}`] ?? process.env[key]
}

/**
 * Merge multiple header maps with last-source-wins precedence on key
 * collision. Used as `mergeHeaders(moduleOption, envParsed)` so env vars
 * (the operator's escape hatch) override committed config without a
 * redeploy. Undefined sources are skipped.
 *
 * Key matching is case-sensitive; operators are responsible for using
 * consistent casing across config and env. HTTP headers are wire-level
 * case-insensitive but the SDK passes them through verbatim, so a
 * collision under different casings would put both on the wire.
 */
export function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const source of sources) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      result[key] = value
    }
  }
  return result
}

/**
 * The `headers` value from runtime config, if it is still a header map.
 * Nitro binds `NUXT_OPENFGA_HEADERS` onto `runtimeConfig.openfga.headers`,
 * replacing the object with the raw env string. That string is parsed
 * separately through `envValue('OPENFGA_HEADERS')`, so a non-object here is
 * ignored rather than spread character by character into headers.
 */
export function configHeaders(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') result[key] = v
  }
  return result
}
