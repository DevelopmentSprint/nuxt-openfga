---
"@developmentsprint/nuxt-openfga": patch
---

The memory evaluator memoizes cycle-free subproblems within a check or `listObjects` call, so models where many paths reach the same relation (diamonds) no longer take exponential time. Answers and depth-cap errors are unchanged.
