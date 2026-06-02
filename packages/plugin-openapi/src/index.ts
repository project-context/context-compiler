import { resolve } from 'node:path'
import SwaggerParser from '@apidevtools/swagger-parser'
import type { ContextNode, ParserPlugin, SourceConfig, SourceRef } from '@context-compiler/core'

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'])

interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>
}

interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
}

export function createOpenApiParserPlugin(): ParserPlugin {
  return {
    name: 'parser-openapi',
    sourceTypes: ['openapi'],
    async parse(source: SourceConfig, context): Promise<{ nodes: ContextNode[] }> {
      const filePath = resolve(context.rootDir, source.path)
      const document = (await SwaggerParser.parse(filePath)) as OpenApiDocument
      const sourceRef: SourceRef = {
        uri: `file://${source.path}`,
        type: source.type,
        name: source.name
      }
      const nodes: ContextNode[] = []

      for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
        for (const [method, operation] of Object.entries(pathItem ?? {})) {
          if (!HTTP_METHODS.has(method.toLowerCase())) {
            continue
          }
          const openApiOperation = operation as OpenApiOperation
          const normalizedMethod = method.toUpperCase()
          nodes.push({
            id: `API-${normalizedMethod}-${slugPath(path)}`,
            type: 'api_contract',
            title: `${normalizedMethod} ${path}`,
            content: openApiOperation.description ?? openApiOperation.summary,
            source: sourceRef,
            tags: openApiOperation.tags ?? [],
            metadata: {
              method: normalizedMethod,
              path,
              operationId: openApiOperation.operationId
            }
          })
        }
      }

      return { nodes }
    }
  }
}

function slugPath(path: string): string {
  return path
    .replace(/[{}]/g, '')
    .replace(/^\//, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

