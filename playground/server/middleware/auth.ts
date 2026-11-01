// Stand-in for a real authentication layer: trusts a `demo-user` cookie.
// Users listed in ORG_ADMINS get an admin fact as a contextual tuple, the way
// an app would map its own role table onto OpenFGA without persisting tuples.
const ORG_ADMINS = new Set(['carol'])

export default defineEventHandler((event) => {
  const userId = getCookie(event, 'demo-user')
  if (!userId) return
  event.context.auth = { userId }
  if (ORG_ADMINS.has(userId)) {
    event.context.roleTuples = [{ user: `user:${userId}`, relation: 'admin', object: 'org:acme' }]
  }
})
