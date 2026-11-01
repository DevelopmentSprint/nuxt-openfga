// Seeds the in-memory store. The model is the JSON form of openfga/model.fga
// (`fga model transform --file openfga/model.fga`).
const model = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'org',
      relations: {
        admin: { this: {} },
        member: { union: { child: [{ this: {} }, { computedUserset: { relation: 'admin' } }] } },
      },
    },
    {
      type: 'document',
      relations: {
        org: { this: {} },
        owner: { this: {} },
        viewer: {
          union: {
            child: [
              { this: {} },
              { computedUserset: { relation: 'owner' } },
              { tupleToUserset: { tupleset: { relation: 'org' }, computedUserset: { relation: 'member' } } },
            ],
          },
        },
      },
    },
  ],
}

export default defineNitroPlugin(() => {
  process.env.OPENFGA_MODE = 'memory'
  loadMemoryStore({
    model,
    tuples: [
      { user: 'user:alice', relation: 'owner', object: 'document:roadmap' },
      { user: 'org:acme', relation: 'org', object: 'document:handbook' },
      { user: 'user:bob', relation: 'member', object: 'org:acme' },
    ],
  })
})
