---
seo:
  title: OpenFGA authorization for Nuxt
  description: Cached server helpers, route guards, a <Can> component and an in-memory evaluator for tests, for OpenFGA in Nuxt 4.
---

::u-page-hero
#title
OpenFGA authorization for Nuxt

#description
Check relationships on the server, gate the UI during SSR, and test your model without an OpenFGA server.

#links
  :::u-button
  ---
  size: xl
  to: /getting-started/installation
  trailing-icon: i-lucide-arrow-right
  ---
  Get started
  :::

  :::u-button
  ---
  color: neutral
  icon: i-simple-icons-github
  size: xl
  to: https://github.com/DevelopmentSprint/nuxt-openfga
  variant: outline
  ---
  View on GitHub
  :::
::

::u-page-section
#features
  :::u-page-feature
  ---
  icon: i-lucide-server
  to: /guide/server
  ---
  #title
  Server helpers

  #description
  Check, write and list relationships from Nitro with auto-imported helpers and a per-process decision cache.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-shield-check
  to: /guide/server#route-guards
  ---
  #title
  Route guards

  #description
  `requireRelation` responds 401, 400 or 403 before your handler runs.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-eye
  to: /guide/ui
  ---
  #title
  UI gating

  #description
  A `<Can>` component and `useCan` composable, resolved during SSR so gated content does not pop in after hydration.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-layers
  to: /guide/contextual-tuples
  ---
  #title
  Contextual tuples

  #description
  Role facts you already store reach OpenFGA without being duplicated as tuples.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-flask-conical
  to: /guide/memory-mode
  ---
  #title
  Memory mode

  #description
  An in-memory evaluator for tests and local development. CI checks it against a real OpenFGA server.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-upload
  to: /guide/model-deployment
  ---
  #title
  Model deployment

  #description
  Optionally deploy your `.fga` model when the server starts, for servers that accept DSL bodies.
  :::
::
