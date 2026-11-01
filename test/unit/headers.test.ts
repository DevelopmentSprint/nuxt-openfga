import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parseHeaders,
  mergeHeaders,
  envValue,
} from '../../src/runtime/server/utils/headers'

describe('parseHeaders', () => {
  it('returns an empty object for undefined input', () => {
    expect(parseHeaders(undefined)).toEqual({})
  })

  it('returns an empty object for an empty string', () => {
    expect(parseHeaders('')).toEqual({})
  })

  it('returns an empty object for whitespace-only input', () => {
    expect(parseHeaders('   \t  ')).toEqual({})
  })

  it('parses a single Key: Value pair', () => {
    expect(parseHeaders('X-Tenant: rp')).toEqual({ 'X-Tenant': 'rp' })
  })

  it('parses multiple comma-separated pairs', () => {
    expect(parseHeaders('X-Tenant: rp, Authorization: Bearer abc')).toEqual({
      'X-Tenant': 'rp',
      'Authorization': 'Bearer abc',
    })
  })

  it('trims surrounding whitespace from keys and values', () => {
    expect(parseHeaders('   X-Tenant   :   rp   ,   X-Other:value')).toEqual({
      'X-Tenant': 'rp',
      'X-Other': 'value',
    })
  })

  it('preserves whitespace within values (e.g. "Bearer abc")', () => {
    expect(parseHeaders('Authorization: Bearer abc def')).toEqual({
      'Authorization': 'Bearer abc def',
    })
  })

  it('only splits on the first colon — values may contain colons', () => {
    expect(parseHeaders('X-Trace: req:abc:123')).toEqual({
      'X-Trace': 'req:abc:123',
    })
  })

  it('silently ignores empty entries from trailing or double commas', () => {
    expect(parseHeaders('X-Tenant: rp,,, ,')).toEqual({ 'X-Tenant': 'rp' })
  })

  it('drops malformed entries (no colon) and reports them via onMalformed', () => {
    const malformed: string[] = []
    const result = parseHeaders('foo, X-Tenant: rp', e => malformed.push(e))
    expect(result).toEqual({ 'X-Tenant': 'rp' })
    expect(malformed).toEqual(['foo'])
  })

  it('drops entries with empty keys and reports them via onMalformed', () => {
    const malformed: string[] = []
    const result = parseHeaders(': rp, X-Tenant: ok', e => malformed.push(e))
    expect(result).toEqual({ 'X-Tenant': 'ok' })
    expect(malformed).toEqual([': rp'])
  })

  it('preserves a later occurrence of the same key within a single string (last wins)', () => {
    expect(parseHeaders('X: a, X: b')).toEqual({ X: 'b' })
  })
})

describe('mergeHeaders', () => {
  it('returns an empty object when no sources are given', () => {
    expect(mergeHeaders()).toEqual({})
  })

  it('skips undefined sources', () => {
    expect(mergeHeaders(undefined, { A: '1' }, undefined)).toEqual({ A: '1' })
  })

  it('merges disjoint sources', () => {
    expect(mergeHeaders({ A: '1' }, { B: '2' })).toEqual({ A: '1', B: '2' })
  })

  it('lets later sources override earlier ones on key collision (env wins when called as mergeHeaders(option, env))', () => {
    expect(
      mergeHeaders(
        { Authorization: 'from-config' },
        { Authorization: 'from-env' },
      ),
    ).toEqual({ Authorization: 'from-env' })
  })

  it('treats keys case-sensitively (operators are responsible for consistent casing)', () => {
    expect(
      mergeHeaders(
        { Authorization: 'A' },
        { authorization: 'B' },
      ),
    ).toEqual({ Authorization: 'A', authorization: 'B' })
  })
})

describe('envValue', () => {
  const KEY = 'OPENFGA_TEST_ENV_KEY'
  const NUXT_KEY = 'NUXT_OPENFGA_TEST_ENV_KEY'

  beforeEach(() => {
    Reflect.deleteProperty(process.env, KEY)
    Reflect.deleteProperty(process.env, NUXT_KEY)
  })
  afterEach(() => {
    Reflect.deleteProperty(process.env, KEY)
    Reflect.deleteProperty(process.env, NUXT_KEY)
  })

  it('returns undefined when neither form is set', () => {
    expect(envValue(KEY)).toBeUndefined()
  })

  it('returns the bare value when only the bare form is set', () => {
    process.env[KEY] = 'bare'
    expect(envValue(KEY)).toBe('bare')
  })

  it('returns the NUXT_ value when only the NUXT_ form is set', () => {
    process.env[NUXT_KEY] = 'nuxt'
    expect(envValue(KEY)).toBe('nuxt')
  })

  it('prefers NUXT_ over the bare form when both are set', () => {
    process.env[KEY] = 'bare'
    process.env[NUXT_KEY] = 'nuxt'
    expect(envValue(KEY)).toBe('nuxt')
  })
})
