// Type shims for Nuxt and Nitro virtual modules, so the runtime sources
// typecheck standalone. Inside a host app, Nuxt's generated types replace them.
type RuntimeConfigShape = {
  openfga?: Record<string, unknown>
  [key: string]: unknown
}

declare module '#imports' {
  import type { H3Error } from 'h3'
  import type { Ref } from 'vue'

  export const useRuntimeConfig: () => RuntimeConfigShape
  export const createError: (input: {
    statusCode: number
    message?: string
    statusMessage?: string
    data?: unknown
  }) => H3Error
  export const defineNitroPlugin: (plugin: () => unknown) => unknown
  export function useFetch<T>(
    url: string,
    options?: Record<string, unknown>,
  ): {
    data: Ref<T | undefined>
    pending: Ref<boolean>
    error: Ref<unknown>
    refresh: () => Promise<void>
  }
}
