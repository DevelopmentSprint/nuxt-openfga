/**
 * Pure in-memory OpenFGA evaluator.
 *
 * Implements this subset of the OpenFGA rewrite algebra: `this`, `computedUserset`, `tupleToUserset`, `union`,
 * `intersection`, `difference`, plus wildcard subjects (`type:*`) and
 * userset subjects (`type:id#relation`). Pure: takes a model + tuple
 * set, returns deterministic check / listObjects results without any
 * I/O.
 *
 * The module is type-agnostic — the model and tuples are caller-supplied.
 *
 * Limitations (acceptable for CI parity / dev tooling):
 *   - listObjects enumerates by scanning tuples for objects of the
 *     requested type, then forward-checking each. Objects with no
 *     tuples about them are not enumerated. For models whose relations
 *     bottom out in `this` (the typical shape), this is correct; a
 *     synthetic relation that grants access without any tuple would
 *     not surface here.
 *   - Recursion depth cap = 32 (see DEFAULT_MAX_DEPTH). Exceeding it throws
 *     rather than answering, so a cut-off branch cannot grant access.
 *
 * Within one check or listObjects call, a (subject, relation, object) result
 * whose evaluation met no cycle is memoized, so diamond-shaped models are not
 * re-evaluated exponentially often. Results inside a cycle depend on where the
 * cycle was entered and are always recomputed. Answers and depth-cap throws
 * match the unmemoized evaluator; test/unit/memory-evaluator-memo.test.ts
 * compares the two on random models.
 */

export interface ObjectRef { object?: string; relation: string }

export interface Userset {
  this?: object
  computedUserset?: ObjectRef
  tupleToUserset?: { tupleset: ObjectRef; computedUserset: ObjectRef }
  union?: { child: Userset[] }
  intersection?: { child: Userset[] }
  difference?: { base: Userset; subtract: Userset }
}

export interface TypeDefinition {
  type: string
  relations?: Record<string, Userset>
}

export interface AuthorizationModel {
  schema_version: string
  type_definitions: TypeDefinition[]
}

export interface MemoryTuple {
  user: string
  relation: string
  object: string
}

const DEFAULT_MAX_DEPTH = 32

interface EvalCtx {
  model: AuthorizationModel
  tuples: MemoryTuple[]
  /** Keys on the current resolution path. */
  path: Set<string>
  depth: number
  maxDepth: number
  /**
   * Results of subtrees that met no cycle, with the height of the subtree
   * (deepest entry depth minus their own). Inside a cycle the answer depends
   * on where the cycle was entered, so those results are never stored.
   */
  memo: Map<string, { value: boolean; height: number }>
  /** Whether the call being evaluated cut a cycle anywhere below it. */
  cut: boolean
  /** Deepest entry depth reached inside the call being evaluated. */
  deepest: number
}

function makeCtx(model: AuthorizationModel, tuples: MemoryTuple[], memo = new Map<string, { value: boolean; height: number }>(), maxDepth = DEFAULT_MAX_DEPTH): EvalCtx {
  return { model, tuples, path: new Set(), depth: 0, maxDepth, memo, cut: false, deepest: 0 }
}

function depthExceeded(ctx: EvalCtx, relation: string, object: string): Error {
  return new Error(`[nuxt-openfga] memory evaluator exceeded resolution depth ${ctx.maxDepth} at ${relation} on ${object}`)
}

function getRelation(model: AuthorizationModel, type: string, relation: string): Userset | undefined {
  const td = model.type_definitions.find((t) => t.type === type)
  return td?.relations?.[relation]
}

function subjectType(subject: string): string {
  // "user:alice" → "user"; "group:g-1#member" → "group"
  const colonIdx = subject.indexOf(':')
  return colonIdx === -1 ? subject : subject.slice(0, colonIdx)
}

function parseUserset(subject: string): { object: string; relation: string } | null {
  // "group:g-1#member" → { object: "group:g-1", relation: "member" }
  const hashIdx = subject.indexOf('#')
  if (hashIdx === -1) return null
  return { object: subject.slice(0, hashIdx), relation: subject.slice(hashIdx + 1) }
}

function parseObject(object: string): { type: string; id: string } {
  const colonIdx = object.indexOf(':')
  if (colonIdx === -1) return { type: object, id: '' }
  return { type: object.slice(0, colonIdx), id: object.slice(colonIdx + 1) }
}

function checkRecursive(
  ctx: EvalCtx,
  subject: string,
  relation: string,
  object: string,
): boolean {
  // Returning false here would fail open under `difference` (base but not
  // subtract), so exceeding the cap is an error, as OpenFGA reports one too.
  if (ctx.depth > ctx.maxDepth) throw depthExceeded(ctx, relation, object)
  ctx.deepest = Math.max(ctx.deepest, ctx.depth)

  const key = `${subject}::${relation}::${object}`

  // A key already on the path is a cycle: cut it, and mark every enclosing
  // call as path-dependent.
  if (ctx.path.has(key)) {
    ctx.cut = true
    return false
  }

  // A memoized subtree is replayed with its height, so the depth cap throws
  // exactly where re-evaluating it would have.
  const memoized = ctx.memo.get(key)
  if (memoized) {
    if (ctx.depth + memoized.height > ctx.maxDepth) throw depthExceeded(ctx, relation, object)
    ctx.deepest = Math.max(ctx.deepest, ctx.depth + memoized.height)
    return memoized.value
  }

  const index = ctx.depth
  const outerCut = ctx.cut
  const outerDeepest = ctx.deepest
  ctx.cut = false
  ctx.deepest = index
  ctx.path.add(key)
  ctx.depth += 1

  let value: boolean
  try {
    const { type } = parseObject(object)
    const userset = getRelation(ctx.model, type, relation)
    value = userset ? evaluateUserset(ctx, subject, relation, object, userset) : false
  }
  finally {
    ctx.depth -= 1
    ctx.path.delete(key)
  }

  // A subtree that met no cycle evaluates the same way from any path, so its
  // result and height can be replayed wherever the key is reached again.
  if (!ctx.cut) ctx.memo.set(key, { value, height: ctx.deepest - index })
  ctx.cut = outerCut || ctx.cut
  ctx.deepest = Math.max(outerDeepest, ctx.deepest)
  return value
}

function evaluateUserset(
  ctx: EvalCtx,
  subject: string,
  relation: string,
  object: string,
  userset: Userset,
): boolean {
  if (userset.this !== undefined) {
    return evaluateThis(ctx, subject, relation, object)
  }
  if (userset.computedUserset) {
    return checkRecursive(ctx, subject, userset.computedUserset.relation, object)
  }
  if (userset.tupleToUserset) {
    return evaluateTupleToUserset(ctx, subject, object, userset.tupleToUserset)
  }
  if (userset.union) {
    return userset.union.child.some((c) => evaluateUserset(ctx, subject, relation, object, c))
  }
  if (userset.intersection) {
    return userset.intersection.child.every((c) => evaluateUserset(ctx, subject, relation, object, c))
  }
  if (userset.difference) {
    return (
      evaluateUserset(ctx, subject, relation, object, userset.difference.base)
      && !evaluateUserset(ctx, subject, relation, object, userset.difference.subtract)
    )
  }
  return false
}

function evaluateThis(
  ctx: EvalCtx,
  subject: string,
  relation: string,
  object: string,
): boolean {
  for (const tuple of ctx.tuples) {
    if (tuple.relation !== relation || tuple.object !== object) continue

    // Direct match
    if (tuple.user === subject) return true

    // Wildcard: "user:*" matches any object of type "user". Like OpenFGA, it
    // does not match a userset subject such as "group:eng#member".
    if (tuple.user.endsWith(':*') && !subject.includes('#')) {
      const wildcardType = tuple.user.slice(0, -2)
      if (subjectType(subject) === wildcardType) return true
    }

    // Userset tuple: "group:g-1#member" — check if subject has
    // `member` on `group:g-1`.
    const userset = parseUserset(tuple.user)
    if (userset) {
      if (checkRecursive(ctx, subject, userset.relation, userset.object)) return true
    }
  }
  return false
}

function evaluateTupleToUserset(
  ctx: EvalCtx,
  subject: string,
  object: string,
  ttu: { tupleset: ObjectRef; computedUserset: ObjectRef },
): boolean {
  // Find all tuples (X, tupleset.relation, object) where X is a typed reference.
  // For each X, check whether subject has computedUserset.relation on X.
  for (const tuple of ctx.tuples) {
    if (tuple.relation !== ttu.tupleset.relation || tuple.object !== object) continue
    // X must be a bare object reference. Usersets and wildcards on the
    // tupleset side are not supported.
    if (tuple.user.includes('#') || tuple.user.endsWith(':*')) continue
    if (checkRecursive(ctx, subject, ttu.computedUserset.relation, tuple.user)) return true
  }
  return false
}

/** Evaluate a check against the in-memory store. */
export function evaluateCheck(
  model: AuthorizationModel,
  tuples: MemoryTuple[],
  subject: string,
  relation: string,
  objectType: string,
  objectId: string,
): boolean {
  return checkObject(model, tuples, subject, relation, `${objectType}:${objectId}`, new Map())
}

function checkObject(
  model: AuthorizationModel,
  tuples: MemoryTuple[],
  subject: string,
  relation: string,
  object: string,
  memo: EvalCtx['memo'],
): boolean {
  return checkRecursive(makeCtx(model, tuples, memo), subject, relation, object)
}

/**
 * List objects of `objectType` that `subject` can access via `relation`.
 * Candidate set = every object of `objectType` mentioned in any tuple
 * (as object). Each candidate is forward-checked.
 */
export function evaluateListObjects(
  model: AuthorizationModel,
  tuples: MemoryTuple[],
  subject: string,
  relation: string,
  objectType: string,
): string[] {
  const prefix = `${objectType}:`
  const candidates = new Set<string>()
  for (const tuple of tuples) {
    if (tuple.object.startsWith(prefix)) {
      candidates.add(tuple.object)
    }
  }

  // Every candidate is checked for the same subject, so they share one memo.
  const memo: EvalCtx['memo'] = new Map()
  const result: string[] = []
  for (const candidate of candidates) {
    if (checkObject(model, tuples, subject, relation, candidate, memo)) {
      result.push(candidate)
    }
  }
  return result
}
