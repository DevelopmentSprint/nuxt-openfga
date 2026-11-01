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
  visited: Set<string>
  depth: number
  maxDepth: number
}

function makeCtx(model: AuthorizationModel, tuples: MemoryTuple[], maxDepth = DEFAULT_MAX_DEPTH): EvalCtx {
  return { model, tuples, visited: new Set(), depth: 0, maxDepth }
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
  if (ctx.depth > ctx.maxDepth) {
    throw new Error(`[nuxt-openfga] memory evaluator exceeded resolution depth ${ctx.maxDepth} at ${relation} on ${object}`)
  }

  const key = `${subject}::${relation}::${object}`
  if (ctx.visited.has(key)) return false
  ctx.visited.add(key)
  ctx.depth += 1

  try {
    const { type } = parseObject(object)
    const userset = getRelation(ctx.model, type, relation)
    if (!userset) return false

    return evaluateUserset(ctx, subject, relation, object, userset)
  }
  finally {
    ctx.depth -= 1
    ctx.visited.delete(key)
  }
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
  const ctx = makeCtx(model, tuples)
  return checkRecursive(ctx, subject, relation, `${objectType}:${objectId}`)
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

  const result: string[] = []
  for (const candidate of candidates) {
    const { id } = parseObject(candidate)
    if (evaluateCheck(model, tuples, subject, relation, objectType, id)) {
      result.push(candidate)
    }
  }
  return result
}
