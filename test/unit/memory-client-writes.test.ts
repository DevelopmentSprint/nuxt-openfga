import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryFgaClient, loadMemoryStore, resetMemoryStore } from '../../src/runtime/server/utils/memory-store'
import type { AuthorizationModel } from '../../src/runtime/server/utils/memory-evaluator'

// Write semantics confirmed against OpenFGA v1.22.1: duplicate writes and
// deletes of missing tuples are rejected, and a rejected request changes nothing.
const MODEL: AuthorizationModel = {
  schema_version: '1.1',
  type_definitions: [{ type: 'user' }, { type: 'doc', relations: { viewer: { this: {} } } }],
}
const alice = { user: 'user:alice', relation: 'viewer', object: 'doc:1' }
const bob = { user: 'user:bob', relation: 'viewer', object: 'doc:1' }

describe('MemoryFgaClient.write', () => {
  const client = new MemoryFgaClient()
  beforeEach(() => {
    resetMemoryStore()
    loadMemoryStore({ model: MODEL, tuples: [alice] })
  })

  it('rejects writing a tuple that already exists', async () => {
    await expect(client.write({ writes: [alice] })).rejects.toThrow(/already exists/)
  })

  it('rejects deleting a tuple that does not exist', async () => {
    await expect(client.write({ deletes: [bob] })).rejects.toThrow(/does not exist/)
  })

  it('applies nothing when any part of the request is rejected', async () => {
    await expect(client.write({ writes: [bob], deletes: [{ ...bob, user: 'user:zed' }] })).rejects.toThrow()
    expect((await client.check(bob)).allowed).toBe(false)
  })

  it('applies valid writes and deletes together', async () => {
    await client.write({ writes: [bob], deletes: [alice] })
    expect((await client.check(bob)).allowed).toBe(true)
    expect((await client.check(alice)).allowed).toBe(false)
  })
})
