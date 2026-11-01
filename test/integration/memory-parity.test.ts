import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { OpenFgaClient } from '@openfga/sdk'
import { execFileSync } from 'node:child_process'
import {
  evaluateCheck,
  evaluateListObjects,
  type AuthorizationModel,
  type MemoryTuple,
} from '../../src/runtime/server/utils/memory-evaluator'

/**
 * Parity test: identical model + tuple set, evaluated by the real
 * OpenFGA server vs the in-memory evaluator. Asserts equal output
 * across the supported rewrite shapes:
 *   direct (this), union/computedUserset, tupleToUserset, difference,
 *   intersection, and recursive descendant via tupleToUserset.
 *
 * PREREQUISITES:
 *   - OpenFGA server reachable at OPENFGA_API_URL (default http://localhost:8080).
 * Skipped when no server is reachable, unless OPENFGA_REQUIRE_SERVER is set.
 */

const OPENFGA_API_URL = process.env['OPENFGA_API_URL'] ?? 'http://localhost:8080'
const OPENFGA_AVAILABLE = (() => {
  try {
    execFileSync(process.execPath, ['-e', `
      const base = ${JSON.stringify(OPENFGA_API_URL)};
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1000);
      fetch(base + '/stores', { signal: controller.signal }).then((response) => {
        process.exit(response.ok ? 0 : 1);
      }).catch(() => process.exit(1));
    `], { stdio: 'ignore', timeout: 1500 })
    return true
  }
  catch {
    return false
  }
})()
if (!OPENFGA_AVAILABLE && process.env['OPENFGA_REQUIRE_SERVER']) {
  // CI sets this so an unreachable server fails the job instead of skipping it.
  throw new Error(`OPENFGA_REQUIRE_SERVER is set but no OpenFGA server answered at ${OPENFGA_API_URL}`)
}
const describeParity = OPENFGA_AVAILABLE ? describe : describe.skip

const MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'team',
      relations: {
        descendant: { this: {} },
        member: { this: {} },
        member_or_higher: {
          union: {
            child: [
              { computedUserset: { object: '', relation: 'member' } },
              {
                tupleToUserset: {
                  tupleset: { object: '', relation: 'descendant' },
                  computedUserset: { object: '', relation: 'member_or_higher' },
                },
              },
            ],
          },
        },
      },
      metadata: {
        relations: {
          descendant: { directly_related_user_types: [{ type: 'team' }] },
          member: { directly_related_user_types: [{ type: 'user' }] },
          member_or_higher: { directly_related_user_types: [] },
        },
      },
    },
    {
      type: 'tool',
      relations: {
        grants_to: { this: {} },
        team_member: { this: {} },
        excluded: { this: {} },
        can_invoke: {
          difference: {
            // OpenFGA 1.9+ rejects a union with fewer than two children.
            base: { computedUserset: { object: '', relation: 'grants_to' } },
            subtract: { computedUserset: { object: '', relation: 'excluded' } },
          },
        },
        can_admin: {
          intersection: {
            child: [
              { computedUserset: { object: '', relation: 'grants_to' } },
              { computedUserset: { object: '', relation: 'team_member' } },
            ],
          },
        },
      },
      metadata: {
        relations: {
          grants_to: { directly_related_user_types: [{ type: 'user' }, { type: 'team', relation: 'member_or_higher' }] },
          team_member: { directly_related_user_types: [{ type: 'user' }] },
          excluded: { directly_related_user_types: [{ type: 'user' }] },
          can_invoke: { directly_related_user_types: [] },
          can_admin: { directly_related_user_types: [] },
        },
      },
    },
  ],
} as AuthorizationModel

const TUPLES: MemoryTuple[] = [
  { user: 'user:alice', relation: 'member', object: 'team:platform-eng' },
  { user: 'team:platform-eng', relation: 'descendant', object: 'team:backend' },
  { user: 'team:platform-eng', relation: 'descendant', object: 'team:frontend' },
  { user: 'team:platform-eng#member_or_higher', relation: 'grants_to', object: 'tool:ci' },
  { user: 'team:backend#member_or_higher', relation: 'grants_to', object: 'tool:deploy' },
  { user: 'user:alice', relation: 'team_member', object: 'tool:ci' },
  { user: 'user:alice', relation: 'excluded', object: 'tool:deploy' },
]

interface CheckCase { name: string; subject: string; relation: string; objectType: string; objectId: string }
interface ListCase { name: string; subject: string; relation: string; objectType: string }

const CHECK_CASES: CheckCase[] = [
  { name: 'direct relation', subject: 'user:alice', relation: 'member', objectType: 'team', objectId: 'platform-eng' },
  { name: 'union/computedUserset', subject: 'user:alice', relation: 'member_or_higher', objectType: 'team', objectId: 'platform-eng' },
  { name: 'tupleToUserset', subject: 'user:alice', relation: 'member_or_higher', objectType: 'team', objectId: 'backend' },
  { name: 'recursive descendant (depth 1)', subject: 'user:alice', relation: 'member_or_higher', objectType: 'team', objectId: 'frontend' },
  { name: 'difference (base true, subtract false)', subject: 'user:alice', relation: 'can_invoke', objectType: 'tool', objectId: 'ci' },
  { name: 'difference (base true, subtract true → false)', subject: 'user:alice', relation: 'can_invoke', objectType: 'tool', objectId: 'deploy' },
  { name: 'intersection (both true)', subject: 'user:alice', relation: 'can_admin', objectType: 'tool', objectId: 'ci' },
  { name: 'intersection (one false)', subject: 'user:alice', relation: 'can_admin', objectType: 'tool', objectId: 'deploy' },
  { name: 'denial for unrelated subject', subject: 'user:bob', relation: 'member_or_higher', objectType: 'team', objectId: 'platform-eng' },
]

const LIST_CASES: ListCase[] = [
  { name: 'list tools (can_invoke)', subject: 'user:alice', relation: 'can_invoke', objectType: 'tool' },
  { name: 'list tiers (member_or_higher)', subject: 'user:alice', relation: 'member_or_higher', objectType: 'team' },
]

describeParity('OpenFGA memory-vs-server parity', () => {
  let serverClient: OpenFgaClient
  let storeId: string
  let modelId: string

  beforeAll(async () => {
    const tempClient = new OpenFgaClient({ apiUrl: OPENFGA_API_URL, storeId: '' })
    const store = await tempClient.createStore({ name: `parity-test-${Date.now()}` })
    storeId = store.id!

    serverClient = new OpenFgaClient({ apiUrl: OPENFGA_API_URL, storeId })

    const result = await serverClient.writeAuthorizationModel(MODEL as never)
    modelId = result.authorization_model_id!

    serverClient = new OpenFgaClient({
      apiUrl: OPENFGA_API_URL,
      storeId,
      authorizationModelId: modelId,
    })

    await serverClient.write({ writes: TUPLES })
  })

  afterAll(async () => {
    if (storeId) {
      const cleanup = new OpenFgaClient({ apiUrl: OPENFGA_API_URL, storeId })
      try {
        await cleanup.deleteStore()
      }
      catch {
        // best-effort cleanup
      }
    }
  })

  describe('check', () => {
    for (const c of CHECK_CASES) {
      it(`${c.name}: memory == server`, async () => {
        const memory = evaluateCheck(MODEL, TUPLES, c.subject, c.relation, c.objectType, c.objectId)
        const server = await serverClient.check({
          user: c.subject,
          relation: c.relation,
          object: `${c.objectType}:${c.objectId}`,
        })
        expect(memory).toBe(!!server.allowed)
      })
    }
  })

  describe('listObjects', () => {
    for (const c of LIST_CASES) {
      it(`${c.name}: memory == server`, async () => {
        const memory = evaluateListObjects(MODEL, TUPLES, c.subject, c.relation, c.objectType).sort()
        const server = await serverClient.listObjects({
          user: c.subject,
          relation: c.relation,
          type: c.objectType,
        })
        const serverObjects = (server.objects ?? []).sort()
        expect(memory).toEqual(serverObjects)
      })
    }
  })
})
