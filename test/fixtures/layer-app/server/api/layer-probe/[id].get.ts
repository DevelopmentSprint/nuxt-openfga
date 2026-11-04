// A guard written in the extending app, using the layer's auth middleware.
export default defineEventHandler({
  onRequest: [requireRelation('document', 'viewer', event => getRouterParam(event, 'id')!, getAuthzContextualTuples)],
  handler: event => ({ id: getRouterParam(event, 'id') }),
})
