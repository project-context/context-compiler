import { defineComponent, type ContextComponent, type ParsedArtifact } from '@context-compiler/core/sdk'

/** Minimal OpenAPI operation representation used by the local distribution. */
export interface ParsedOpenApiOperation {
  method: string
  path: string
  operationId?: string
  summary?: string
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'])

/** Create the default OpenAPI parse component. */
export function createOpenApiParseComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'parse.openapi',
      stage: 'parse',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['raw-artifact:application/openapi'],
      outputs: ['parsed-artifact:openapi'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const parsedArtifacts: ParsedArtifact[] = state.rawArtifacts
        .filter((artifact) => artifact.mediaType === 'application/openapi')
        .flatMap((artifact) =>
          parseOpenApiOperations(artifact.content).map((operation) => ({
            id: `parsed:openapi:${operation.method}:${operation.path}`,
            kind: 'parsed' as const,
            parser: 'openapi',
            source: artifact.source,
            data: operation,
            metadata: artifact.metadata
          }))
        )
      return { parsedArtifacts }
    }
  })
}

function parseOpenApiOperations(content: string): ParsedOpenApiOperation[] {
  const operations: ParsedOpenApiOperation[] = []
  const lines = content.split(/\r?\n/)
  let inPaths = false
  let currentPath = ''
  let currentOperation: ParsedOpenApiOperation | undefined

  for (const line of lines) {
    const indent = line.search(/\S|$/)
    const trimmed = line.trim()
    if (trimmed === 'paths:') {
      inPaths = true
      continue
    }
    if (!inPaths || trimmed.length === 0) {
      continue
    }
    const pathMatch = trimmed.match(/^(\/[^:]+):$/)
    if (indent === 2 && pathMatch) {
      currentPath = pathMatch[1]
      continue
    }
    const methodMatch = trimmed.match(/^([a-z]+):$/)
    if (indent === 4 && methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      currentOperation = { method: methodMatch[1].toUpperCase(), path: currentPath }
      operations.push(currentOperation)
      continue
    }
    const operationId = trimmed.match(/^operationId:\s*(.+)$/)
    if (currentOperation && operationId) {
      currentOperation.operationId = operationId[1].trim()
    }
    const summary = trimmed.match(/^summary:\s*(.+)$/)
    if (currentOperation && summary) {
      currentOperation.summary = summary[1].trim()
    }
  }

  return operations
}
