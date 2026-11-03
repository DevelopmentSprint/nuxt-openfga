<script setup lang="ts">
const { allowed } = useCan('viewer', 'document', 'roadmap')
</script>

<template>
  <main>
    <p :data-testid="allowed ? 'usecan-allowed' : 'usecan-denied'">useCan</p>
    <Can relation="viewer" object-type="document" object-id="handbook">
      <span data-testid="can-allowed">can view</span>
      <template #fallback>
        <span data-testid="can-denied">no access</span>
      </template>
    </Can>
  </main>
</template>
