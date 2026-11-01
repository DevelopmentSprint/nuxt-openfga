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

function parseBody(raw: unknown): { relation: string, objectType: string, objectId: string } | string[] {
  const body = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const invalid = FIELDS.filter(field => typeof body[field] !== 'string' || body[field] === '')
  if (invalid.length > 0) return invalid
  return { relation: body['relation'] as string, objectType: body['objectType'] as string, objectId: body['objectId'] as string }
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
      data: { invalidFields: parsed, expected: 'non-empty strings: relation, objectType, objectId' },
    })
  }

  const contextualTuples = getAuthzContextualTuples(event)
  const allowed = await checkAccess(userId, parsed.relation, parsed.objectType, parsed.objectId, { contextualTuples })
  return { allowed }
})
