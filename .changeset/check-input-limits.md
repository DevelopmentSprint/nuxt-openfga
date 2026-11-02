---
"@developmentsprint/nuxt-openfga": patch
---

`/api/_authz/check` now responds 400 to a relation, object type or object id that OpenFGA itself would reject (its length and character limits), so arbitrary input can no longer churn the shared decision cache.
