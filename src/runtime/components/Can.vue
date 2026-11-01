<script setup lang="ts">
/**
 * <Can> — fence a UI block on an OpenFGA relation.
 *
 * Renders the default slot when the current user has the named
 * relation on the named object. While the check is in flight the
 * `#pending` slot renders (defaults to nothing — most call sites are
 * happy to render the gated content optimistically null until the
 * check resolves). When the check returns false, the `#fallback`
 * slot renders (defaults to nothing).
 *
 * Example — navigation entry:
 *
 *   <Can relation="admin" object-type="org" :object-id="orgId">
 *     <NuxtLink to="/settings">Settings</NuxtLink>
 *   </Can>
 *
 * Example — inline placeholder:
 *
 *   <Can relation="can_view" object-type="document" :object-id="docId">
 *     <DocumentDetail :doc="doc" />
 *     <template #fallback>
 *       <p>You don't have access to this document.</p>
 *     </template>
 *   </Can>
 *
 * Hiding a UI element does not protect data. Every protected endpoint
 * must still enforce the relation on the server.
 */
import { useCan } from '../composables/useCan'

const props = defineProps<{
  relation: string
  objectType: string
  objectId: string
}>()

const { allowed, pending } = useCan(
  () => props.relation,
  () => props.objectType,
  () => props.objectId,
)
</script>

<template>
  <slot v-if="allowed" />
  <slot v-else-if="pending" name="pending" />
  <slot v-else name="fallback" />
</template>
