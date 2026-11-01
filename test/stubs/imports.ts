// Test-time stand-in for Nuxt's `#imports` virtual module. Tests that need
// specific behavior replace it with vi.mock('#imports', ...).
export const useRuntimeConfig = (() => ({})) as unknown as () => Record<string, unknown>
export const createError = ((input: { statusCode: number, message?: string, statusMessage?: string }) =>
  Object.assign(new Error(input.message ?? input.statusMessage), input)) as unknown as (input: Record<string, unknown>) => Error
export const defineNitroPlugin = (<T>(fn: T) => fn) as unknown as <T>(fn: T) => T
export const useFetch = (() => ({})) as unknown as (...args: unknown[]) => unknown
