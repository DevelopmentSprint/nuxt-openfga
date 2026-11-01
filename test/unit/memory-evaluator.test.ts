import { describe, it, expect } from 'vitest'
import {
  evaluateCheck,
  evaluateListObjects,
} from '../../src/runtime/server/utils/memory-evaluator'
import type { AuthorizationModel, MemoryTuple } from '../../src/runtime/server/utils/memory-evaluator'

/**
 * Model fixtures cover the six supported rewrite shapes:
 *   this, computedUserset, tupleToUserset, union, intersection, difference
 * Plus wildcards (user:*) and userset tuples (group:g1#member).
 */

const SIMPLE_DIRECT_MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'document',
      relations: {
        owner: { this: {} },
      },
    },
  ],
}

const COMPUTED_AND_UNION_MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'document',
      relations: {
        owner: { this: {} },
        editor: { this: {} },
        viewer: { this: {} },
        can_view: {
          union: {
            child: [
              { computedUserset: { relation: 'owner' } },
              { computedUserset: { relation: 'editor' } },
              { computedUserset: { relation: 'viewer' } },
            ],
          },
        },
      },
    },
  ],
}

const TTU_MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'folder',
      relations: { owner: { this: {} } },
    },
    {
      type: 'document',
      relations: {
        parent: { this: {} },
        can_view: {
          tupleToUserset: {
            tupleset: { relation: 'parent' },
            computedUserset: { relation: 'owner' },
          },
        },
      },
    },
  ],
}

const DIFFERENCE_MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'group',
      relations: {
        member: { this: {} },
        restricted: { this: {} },
        can_view_shared: {
          difference: {
            base: { computedUserset: { relation: 'member' } },
            subtract: { computedUserset: { relation: 'restricted' } },
          },
        },
      },
    },
  ],
}

const INTERSECTION_MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'doc',
      relations: {
        editor: { this: {} },
        team_member: { this: {} },
        can_publish: {
          intersection: {
            child: [
              { computedUserset: { relation: 'editor' } },
              { computedUserset: { relation: 'team_member' } },
            ],
          },
        },
      },
    },
  ],
}

const USERSET_TUPLE_MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'group',
      relations: { member: { this: {} } },
    },
    {
      type: 'document',
      relations: {
        viewer: { this: {} },
        can_view: { computedUserset: { relation: 'viewer' } },
      },
    },
  ],
}

describe('memory evaluator — check', () => {
  describe('direct relation (this)', () => {
    it('returns true when a direct tuple exists', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:alice', relation: 'owner', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(SIMPLE_DIRECT_MODEL, tuples, 'user:alice', 'owner', 'document', 'doc-1')).toBe(true)
    })

    it('returns false when no matching tuple exists', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:bob', relation: 'owner', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(SIMPLE_DIRECT_MODEL, tuples, 'user:alice', 'owner', 'document', 'doc-1')).toBe(false)
    })
  })

  describe('wildcards (user:*)', () => {
    it('matches any user when a wildcard tuple exists', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:*', relation: 'owner', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(SIMPLE_DIRECT_MODEL, tuples, 'user:alice', 'owner', 'document', 'doc-1')).toBe(true)
      expect(evaluateCheck(SIMPLE_DIRECT_MODEL, tuples, 'user:bob', 'owner', 'document', 'doc-1')).toBe(true)
    })

    it('does not match wildcards across types', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:*', relation: 'owner', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(SIMPLE_DIRECT_MODEL, tuples, 'organization:org-1', 'owner', 'document', 'doc-1')).toBe(false)
    })
  })

  describe('union + computedUserset', () => {
    it('returns true when any child relation matches', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:alice', relation: 'editor', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(COMPUTED_AND_UNION_MODEL, tuples, 'user:alice', 'can_view', 'document', 'doc-1')).toBe(true)
    })

    it('returns false when no child relation matches', () => {
      const tuples: MemoryTuple[] = []
      expect(evaluateCheck(COMPUTED_AND_UNION_MODEL, tuples, 'user:alice', 'can_view', 'document', 'doc-1')).toBe(false)
    })
  })

  describe('tupleToUserset (X from Y)', () => {
    it('returns true when subject has computedUserset.relation on the resolved tuple', () => {
      const tuples: MemoryTuple[] = [
        { user: 'folder:f-1', relation: 'parent', object: 'document:doc-1' },
        { user: 'user:alice', relation: 'owner', object: 'folder:f-1' },
      ]
      expect(evaluateCheck(TTU_MODEL, tuples, 'user:alice', 'can_view', 'document', 'doc-1')).toBe(true)
    })

    it('returns false when the chain breaks', () => {
      const tuples: MemoryTuple[] = [
        { user: 'folder:f-1', relation: 'parent', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(TTU_MODEL, tuples, 'user:alice', 'can_view', 'document', 'doc-1')).toBe(false)
    })
  })

  describe('difference (but not)', () => {
    it('returns true when base is true and subtract is false', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:alice', relation: 'member', object: 'group:g-1' },
      ]
      expect(evaluateCheck(DIFFERENCE_MODEL, tuples, 'user:alice', 'can_view_shared', 'group', 'g-1')).toBe(true)
    })

    it('returns false when subtract is true (suppresses base)', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:alice', relation: 'member', object: 'group:g-1' },
        { user: 'user:alice', relation: 'restricted', object: 'group:g-1' },
      ]
      expect(evaluateCheck(DIFFERENCE_MODEL, tuples, 'user:alice', 'can_view_shared', 'group', 'g-1')).toBe(false)
    })
  })

  describe('intersection', () => {
    it('returns true when all children match', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:alice', relation: 'editor', object: 'doc:d-1' },
        { user: 'user:alice', relation: 'team_member', object: 'doc:d-1' },
      ]
      expect(evaluateCheck(INTERSECTION_MODEL, tuples, 'user:alice', 'can_publish', 'doc', 'd-1')).toBe(true)
    })

    it('returns false when any child fails', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:alice', relation: 'editor', object: 'doc:d-1' },
      ]
      expect(evaluateCheck(INTERSECTION_MODEL, tuples, 'user:alice', 'can_publish', 'doc', 'd-1')).toBe(false)
    })
  })

  describe('userset tuples (type:id#relation as subject of a tuple)', () => {
    it('grants access via membership in a userset', () => {
      const tuples: MemoryTuple[] = [
        { user: 'user:alice', relation: 'member', object: 'group:g-1' },
        { user: 'group:g-1#member', relation: 'viewer', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(USERSET_TUPLE_MODEL, tuples, 'user:alice', 'can_view', 'document', 'doc-1')).toBe(true)
    })

    it('denies access when subject is not in the userset', () => {
      const tuples: MemoryTuple[] = [
        { user: 'group:g-1#member', relation: 'viewer', object: 'document:doc-1' },
      ]
      expect(evaluateCheck(USERSET_TUPLE_MODEL, tuples, 'user:bob', 'can_view', 'document', 'doc-1')).toBe(false)
    })
  })
})

describe('memory evaluator — listObjects', () => {
  it('returns objects of the given type the subject can access', () => {
    const tuples: MemoryTuple[] = [
      { user: 'user:alice', relation: 'editor', object: 'document:doc-1' },
      { user: 'user:alice', relation: 'viewer', object: 'document:doc-2' },
      { user: 'user:bob', relation: 'owner', object: 'document:doc-3' },
    ]
    const result = evaluateListObjects(COMPUTED_AND_UNION_MODEL, tuples, 'user:alice', 'can_view', 'document')
    expect(result.sort()).toEqual(['document:doc-1', 'document:doc-2'])
  })

  it('returns an empty array when no objects match', () => {
    const tuples: MemoryTuple[] = []
    const result = evaluateListObjects(COMPUTED_AND_UNION_MODEL, tuples, 'user:alice', 'can_view', 'document')
    expect(result).toEqual([])
  })

  it('handles wildcard tuples in enumeration', () => {
    const tuples: MemoryTuple[] = [
      { user: 'user:*', relation: 'viewer', object: 'document:public-1' },
      { user: 'user:alice', relation: 'owner', object: 'document:private-1' },
    ]
    const result = evaluateListObjects(COMPUTED_AND_UNION_MODEL, tuples, 'user:alice', 'can_view', 'document')
    expect(result.sort()).toEqual(['document:private-1', 'document:public-1'])
  })

  it('enumerates through tupleToUserset', () => {
    const tuples: MemoryTuple[] = [
      { user: 'folder:f-1', relation: 'parent', object: 'document:doc-1' },
      { user: 'user:alice', relation: 'owner', object: 'folder:f-1' },
      { user: 'folder:f-2', relation: 'parent', object: 'document:doc-2' },
      { user: 'user:bob', relation: 'owner', object: 'folder:f-2' },
    ]
    const result = evaluateListObjects(TTU_MODEL, tuples, 'user:alice', 'can_view', 'document')
    expect(result).toEqual(['document:doc-1'])
  })
})

describe('memory evaluator — resolution depth', () => {
  // folder:f0 ← parent ← folder:f1 ← … each viewer inherits from its parent.
  const CHAIN_MODEL: AuthorizationModel = {
    schema_version: '1.1',
    type_definitions: [
      { type: 'user' },
      {
        type: 'folder',
        relations: {
          parent: { this: {} },
          blocked: {
            union: {
              child: [
                { this: {} },
                { tupleToUserset: { tupleset: { relation: 'parent' }, computedUserset: { relation: 'blocked' } } },
              ],
            },
          },
          member: { this: {} },
          viewer: { difference: { base: { computedUserset: { relation: 'member' } }, subtract: { computedUserset: { relation: 'blocked' } } } },
        },
      },
    ],
  }

  function chain(length: number): MemoryTuple[] {
    const tuples: MemoryTuple[] = [{ user: 'user:alice', relation: 'blocked', object: 'folder:f0' }]
    for (let i = 1; i <= length; i++) tuples.push({ user: `folder:f${i - 1}`, relation: 'parent', object: `folder:f${i}` })
    tuples.push({ user: 'user:alice', relation: 'member', object: `folder:f${length}` })
    return tuples
  }

  it('denies through a shallow block chain', () => {
    expect(evaluateCheck(CHAIN_MODEL, chain(3), 'user:alice', 'viewer', 'folder', 'f3')).toBe(false)
  })

  it('throws instead of failing open when the subtract branch exceeds the depth cap', () => {
    expect(() => evaluateCheck(CHAIN_MODEL, chain(40), 'user:alice', 'viewer', 'folder', 'f40')).toThrow(/depth/i)
  })
})

describe('memory evaluator — wildcards and usersets', () => {
  // Behavior confirmed against OpenFGA v1.22.1.
  const MODEL: AuthorizationModel = {
    schema_version: '1.1',
    type_definitions: [
      { type: 'user' },
      { type: 'group', relations: { member: { this: {} } } },
      { type: 'doc', relations: { viewer: { this: {} } } },
    ],
  }
  const tuples: MemoryTuple[] = [{ user: 'group:*', relation: 'viewer', object: 'doc:1' }]

  it('matches a concrete object of the wildcard type', () => {
    expect(evaluateCheck(MODEL, tuples, 'group:eng', 'viewer', 'doc', '1')).toBe(true)
  })

  it('does not match a userset subject of that type', () => {
    expect(evaluateCheck(MODEL, tuples, 'group:eng#member', 'viewer', 'doc', '1')).toBe(false)
  })
})
