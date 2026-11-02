/**
 * Memoization must not change any answer, nor where the depth cap throws.
 * Random models are evaluated by the current evaluator and by the unmemoized
 * evaluator it replaced (fixtures/reference-evaluator.ts), and must agree.
 */
import { describe, it, expect } from 'vitest'
import { evaluateCheck, evaluateListObjects, type AuthorizationModel, type MemoryTuple, type Userset } from '../../src/runtime/server/utils/memory-evaluator'
import * as reference from './fixtures/reference-evaluator'

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RELATIONS = ['viewer', 'editor', 'owner', 'blocked']
const TYPES = ['doc', 'folder']

function randomModel(rand: () => number): AuthorizationModel {
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
  const leaf = (): Userset => {
    const r = rand()
    if (r < 0.35) return { this: {} }
    if (r < 0.65) return { computedUserset: { relation: pick(RELATIONS) } }
    return { tupleToUserset: { tupleset: { relation: 'parent' }, computedUserset: { relation: pick(RELATIONS) } } }
  }
  const userset = (depth: number): Userset => {
    if (depth === 0) return leaf()
    const r = rand()
    if (r < 0.4) return leaf()
    if (r < 0.65) return { union: { child: [userset(depth - 1), userset(depth - 1)] } }
    if (r < 0.8) return { intersection: { child: [userset(depth - 1), userset(depth - 1)] } }
    return { difference: { base: userset(depth - 1), subtract: userset(depth - 1) } }
  }
  return {
    schema_version: '1.1',
    type_definitions: [
      { type: 'user' },
      { type: 'group', relations: { member: { union: { child: [{ this: {} }, { computedUserset: { relation: 'member' } }] } } } },
      ...TYPES.map(type => ({
        type,
        relations: Object.fromEntries([
          ['parent', { this: {} }],
          ...RELATIONS.map(relation => [relation, userset(2)]),
        ]),
      })),
    ],
  }
}

function randomTuples(rand: () => number, objects: number): MemoryTuple[] {
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
  const object = () => `${pick(TYPES)}:${Math.floor(rand() * objects)}`
  const tuples: MemoryTuple[] = []
  for (let i = 0; i < objects * 3; i++) {
    const r = rand()
    const user = r < 0.5 ? `user:${pick(['a', 'b'])}` : r < 0.65 ? 'user:*' : r < 0.85 ? `group:${pick(['g', 'h'])}#member` : 'group:g'
    tuples.push({ user, relation: pick(RELATIONS), object: object() })
  }
  // Parent links, including cycles.
  for (let i = 0; i < objects * 2; i++) tuples.push({ user: object(), relation: 'parent', object: object() })
  tuples.push({ user: 'user:a', relation: 'member', object: 'group:g' })
  tuples.push({ user: 'group:g#member', relation: 'member', object: 'group:h' })
  tuples.push({ user: 'group:h#member', relation: 'member', object: 'group:g' })
  return tuples
}

/** A parent chain long enough to cross the depth cap. */
function chainTuples(length: number): MemoryTuple[] {
  const tuples: MemoryTuple[] = [{ user: 'user:a', relation: 'viewer', object: `folder:${length}` }]
  for (let i = 0; i < length; i++) tuples.push({ user: `folder:${i + 1}`, relation: 'parent', object: `folder:${i}` })
  return tuples
}

/**
 * The unmemoized evaluator is exponential on some random models (the reason
 * for memoizing). It runs against a tuple list that stops it after a fixed
 * amount of work; those queries are skipped rather than compared.
 */
class OverBudget extends Error {}
function budgeted(tuples: MemoryTuple[], reads = 200_000): MemoryTuple[] {
  let left = reads
  return new Proxy(tuples, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop) && --left < 0) throw new OverBudget()
      return Reflect.get(target, prop, receiver)
    },
  })
}

type Outcome = boolean | string[] | 'throws' | 'over-budget'
const outcome = (fn: () => boolean | string[]): Outcome => {
  try {
    const value = fn()
    return Array.isArray(value) ? [...value].sort() : value
  }
  catch (error) {
    if (error instanceof OverBudget) return 'over-budget'
    expect(String(error)).toMatch(/exceeded resolution depth/)
    return 'throws'
  }
}

describe('memory evaluator memoization', () => {
  it('agrees with the unmemoized evaluator on random models, including depth-cap throws', () => {
    const counts = { 'true': 0, 'false': 0, 'throws': 0, 'over-budget': 0 }
    for (let seed = 1; seed <= 300; seed++) {
      const rand = prng(seed)
      const model = randomModel(rand)
      const tuples = seed % 5 === 0 ? [...chainTuples(28 + (seed % 10)), ...randomTuples(rand, 4)] : randomTuples(rand, 6)
      for (const subject of ['user:a', 'user:b', 'group:g#member']) {
        for (const relation of RELATIONS) {
          for (const type of TYPES) {
            for (let id = 0; id < 6; id++) {
              const expected = outcome(() => reference.evaluateCheck(model, budgeted(tuples), subject, relation, type, String(id)))
              const actual = outcome(() => evaluateCheck(model, tuples, subject, relation, type, String(id)))
              counts[String(expected) as keyof typeof counts] += 1
              if (expected === 'over-budget') continue
              expect(actual, `seed ${seed}: ${subject} ${relation} ${type}:${id}`).toEqual(expected)
            }
            const expectedList = outcome(() => reference.evaluateListObjects(model, budgeted(tuples), subject, relation, type))
            const actualList = outcome(() => evaluateListObjects(model, tuples, subject, relation, type))
            if (expectedList !== 'over-budget') expect(actualList, `seed ${seed}: list ${subject} ${relation} ${type}`).toEqual(expectedList)
          }
        }
      }
    }
    // The corpus must exercise every outcome, or agreement proves little.
    expect(counts.true).toBeGreaterThan(2000)
    expect(counts.false).toBeGreaterThan(2000)
    expect(counts.throws).toBeGreaterThan(300)
    // Skipped queries must stay rare, or the comparison proves little.
    expect(counts['over-budget']).toBeLessThan(counts.true / 50)
  }, 60_000)

  it('evaluates a diamond-shaped model in linear rather than exponential time', () => {
    // Each node reaches the next through two tuplesets, so an unmemoized walk
    // visits 2^30 paths when the answer is false.
    const levels = 30
    const model: AuthorizationModel = {
      schema_version: '1.1',
      type_definitions: [
        { type: 'user' },
        {
          type: 'node',
          relations: {
            left: { this: {} },
            right: { this: {} },
            viewer: {
              union: {
                child: [
                  { this: {} },
                  { tupleToUserset: { tupleset: { relation: 'left' }, computedUserset: { relation: 'viewer' } } },
                  { tupleToUserset: { tupleset: { relation: 'right' }, computedUserset: { relation: 'viewer' } } },
                ],
              },
            },
          },
        },
      ],
    }
    const tuples: MemoryTuple[] = []
    for (let i = 0; i < levels; i++) {
      tuples.push({ user: `node:${i + 1}`, relation: 'left', object: `node:${i}` })
      tuples.push({ user: `node:${i + 1}`, relation: 'right', object: `node:${i}` })
    }
    tuples.push({ user: 'user:a', relation: 'viewer', object: `node:${levels}` })

    const started = performance.now()
    expect(evaluateCheck(model, tuples, 'user:b', 'viewer', 'node', '0')).toBe(false)
    expect(evaluateCheck(model, tuples, 'user:a', 'viewer', 'node', '0')).toBe(true)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
