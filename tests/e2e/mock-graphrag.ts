import { afterEach, beforeEach } from 'vitest'

export function installMockGraphRagRuntimeHooks(): void {
  let previousGraphRagRuntime: string | undefined

  beforeEach(() => {
    previousGraphRagRuntime = process.env.CONTEXT_GRAPHRAG_RUNTIME
    process.env.CONTEXT_GRAPHRAG_RUNTIME = 'mock'
  })

  afterEach(() => {
    if (previousGraphRagRuntime === undefined) {
      delete process.env.CONTEXT_GRAPHRAG_RUNTIME
    } else {
      process.env.CONTEXT_GRAPHRAG_RUNTIME = previousGraphRagRuntime
    }
  })
}
