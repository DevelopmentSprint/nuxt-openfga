// Exposes the merged module options so the test can check layer precedence.
export default defineEventHandler(() => {
  const { userIdPath, contextualTuplesKey, cacheTtlMs, cacheMaxEntries } = useRuntimeConfig().openfga
  return { userIdPath, contextualTuplesKey, cacheTtlMs, cacheMaxEntries }
})
