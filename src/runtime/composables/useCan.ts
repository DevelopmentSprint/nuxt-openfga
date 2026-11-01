/**
 * useCan — reactive OpenFGA permission check.
 *
 * Wraps `POST /api/_authz/check` so any UI surface can ask "can the
 * current user do X on Y?" without rolling its own fetch. Args are
 * reactive (refs/getters/values) — when an arg changes the query is
 * re-issued.
 *
 * This is for UX gating only: hide an entry point that would 403, or render
 * a "no access" placeholder. It does NOT replace server-side checks; every
 * protected endpoint must still call requireRelation or checkAccessOrThrow.
 *
 * Caching: useFetch dedupes by key within a page load, and the server keeps
 * an LRU of recent decisions. `<Can>` components asking the same question on
 * one page share a single request.
 */
import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useFetch } from '#imports'

export interface UseCanResult {
  allowed: Ref<boolean>
  pending: Ref<boolean>
  error: Ref<unknown>
  refresh: () => Promise<void>
}

interface CheckResponse {
  allowed: boolean
}

export function useCan(
  relation: MaybeRefOrGetter<string>,
  objectType: MaybeRefOrGetter<string>,
  objectId: MaybeRefOrGetter<string>,
): UseCanResult {
  const body = computed(() => ({
    relation: toValue(relation),
    objectType: toValue(objectType),
    objectId: toValue(objectId),
  }))

  // One key per (relation, objectType, objectId), so components asking the
  // same question share a request and a payload entry. The key is reactive:
  // when an argument changes, useFetch moves to the new key and refetches,
  // instead of writing the new answer under the old question's key.
  const key = computed(() =>
    `authz-check:${JSON.stringify([body.value.objectType, body.value.objectId, body.value.relation])}`,
  )

  const { data, pending, error, refresh } = useFetch<CheckResponse>('/api/_authz/check', {
    method: 'POST',
    body,
    key,
    // Run during SSR so the answer is in the hydration payload — the
    // alternative (client-only) renders the fenced block as denied
    // until the post-hydration fetch resolves, producing a visible
    // pop-in. Nuxt's useFetch passes cookies through the server-side
    // call so the session context reaches /api/_authz/check
    // identically to a real browser hit.
    server: true,
    immediate: true,
    default: () => ({ allowed: false }),
  })

  const allowed = computed(() => data.value?.allowed ?? false)

  return {
    allowed,
    pending,
    error,
    refresh: async () => {
      await refresh()
    },
  }
}
