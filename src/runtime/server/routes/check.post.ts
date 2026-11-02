/**
 * POST /api/_authz/check
 *
 * Lets the signed-in user ask "can I do <relation> on <objectType>:<objectId>?"
 * and returns `{ allowed: boolean }`. It uses the same cached `checkAccess`
 * helper as server-side guards, so UI gating and enforcement agree.
 *
 * The subject is always `user:<id>`, with the id read from the session at
 * `openfga.userIdPath`, never from the request body. Callers can only ask
 * about themselves. Contextual tuples at `openfga.contextualTuplesKey` are
 * included, so the answer matches what server-side checks see.
 *
 * Hiding UI is not access control: every protected endpoint must still
 * enforce the relation on the server.
 */
import { defineEventHandler, readBody, createError } from 'h3'
import { checkAccess } from '../utils/openfga'
import { getAuthzContextualTuples, getAuthzUserId } from '../utils/event-context'

const FIELDS = ['relation', 'objectType', 'objectId'] as const

// OpenFGA's own request limits (openfga/api: CheckRequestTupleKey and
// TypeDefinition). Matching them exactly bounds the distinct keys a caller can
// push into the shared decision cache without rejecting any id OpenFGA would
// accept. RE2's \s is ASCII-only, so it is spelled out: JavaScript's \s would
// also reject Unicode spaces that OpenFGA allows. The `u` flag counts code
// points, as RE2 counts runes.
const RELATION = /^[^:#@\t\n\f\r ]{1,50}$/u
const OBJECT_TYPE = /^[^:#@\t\n\f\r ]{1,254}$/u
const OBJECT = /^[^\t\n\f\r ]{2,256}$/u

type CheckBody = { relation: string, objectType: string, objectId: string }

function parseBody(raw: unknown): CheckBody | string[] {
  const body = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const invalid = FIELDS.filter(field => typeof body[field] !== 'string' || body[field] === '')
  if (invalid.length > 0) return invalid
  const parsed = { relation: body['relation'] as string, objectType: body['objectType'] as string, objectId: body['objectId'] as string }
  if (!RELATION.test(parsed.relation)) invalid.push('relation')
  // The object limit covers `type:id` as a whole; judge the id only once the
  // type is valid, so an oversized type is not blamed on the id.
  if (!OBJECT_TYPE.test(parsed.objectType)) invalid.push('objectType')
  else if (!OBJECT.test(`${parsed.objectType}:${parsed.objectId}`)) invalid.push('objectId')
  return invalid.length > 0 ? invalid : parsed
}

export default defineEventHandler(async (event) => {
  const userId = getAuthzUserId(event)
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'authentication required' })
  }

  const raw = await readBody(event).catch(() => undefined)
  const parsed = parseBody(raw)
  if (Array.isArray(parsed)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid body',
      data: { invalidFields: parsed, expected: 'relation: 1-50 chars without : # @ or whitespace; objectType: 1-254 chars without : # @ or whitespace; objectType:objectId: at most 256 chars without whitespace' },
    })
  }

  const contextualTuples = getAuthzContextualTuples(event)
  const allowed = await checkAccess(userId, parsed.relation, parsed.objectType, parsed.objectId, { contextualTuples })
  return { allowed }
})
