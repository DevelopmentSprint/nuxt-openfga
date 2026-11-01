<script setup lang="ts">
const user = useCookie('demo-user')
const users = ['alice', 'bob', 'carol', 'dave']
const documents = ['roadmap', 'handbook']
</script>

<template>
  <main>
    <h1>nuxt-openfga playground</h1>
    <p>
      Signed in as
      <select v-model="user" data-testid="user-select" @change="$router.go(0)">
        <option :value="undefined">nobody</option>
        <option v-for="u in users" :key="u" :value="u">{{ u }}</option>
      </select>
    </p>
    <ul>
      <li v-for="doc in documents" :key="doc">
        {{ doc }}:
        <Can relation="viewer" object-type="document" :object-id="doc">
          <span :data-testid="`allowed-${doc}`">can view</span>
          <template #fallback>
            <span :data-testid="`denied-${doc}`">no access</span>
          </template>
        </Can>
      </li>
    </ul>
    <p>
      alice owns roadmap; bob is a member of the org that owns handbook; carol is
      an org admin through a contextual tuple; dave has no access.
    </p>
  </main>
</template>
