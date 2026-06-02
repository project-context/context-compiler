import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
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
      const nodes: ContextNode[] = []
      const filePaths = await findOpenApiFiles(resolve(context.rootDir, source.path))

      for (const filePath of filePaths) {
        const document = (await SwaggerParser.parse(filePath)) as OpenApiDocument
        const sourceRef: SourceRef = {
          uri: `file://${relative(context.rootDir, filePath).split('\\').join('/')}`,
          type: source.type,
          name: source.name
        }

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
      }

      return { nodes }
    }
  }
}

async function findOpenApiFiles(path: string): Promise<string[]> {
  const pathStat = await stat(path)
  if (pathStat.isFile()) {
    return [path]
  }

  const entries = await readdir(path, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name)
      if (entry.isDirectory()) {
        return findOpenApiFiles(entryPath)
      }
      return entry.isFile() && /^(openapi|swagger)\.(ya?ml|json)$/i.test(entry.name) ? [entryPath] : []
    })
  )
  return files.flat().sort()
}

function slugPath(path: string): string {
  return path
    .replace(/[{}]/g, '')
    .replace(/^\//, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
