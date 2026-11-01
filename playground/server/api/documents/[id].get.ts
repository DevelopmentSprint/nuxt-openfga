// Server-side enforcement: the route guard runs before the handler.
export default defineEventHandler({
  onRequest: [requireRelation('document', 'viewer', event => getRouterParam(event, 'id')!, getAuthzContextualTuples)],
  handler: event => ({ id: getRouterParam(event, 'id') }),
})
