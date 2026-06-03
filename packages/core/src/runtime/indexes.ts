import type { ContextGraph, ContextIndexManifest } from '../contracts/index.js'
import { CONTEXT_RUNTIME_SCHEMA_VERSION } from './schema.js'

export interface ContextSymbolIndexEntry {
  id: string
  name: string
  kind?: string
  file?: string
  language?: string
  source: string
}

export interface ContextApiIndexEntry {
  id: string
  method?: string
  path?: string
  operationId?: string
  title: string
  source: string
}

export interface ContextSearchIndexEntry {
  id: string
  type: string
  title: string
  content?: string
  domain?: string
  tags: string[]
  source: string
  text: string
}

export interface ContextIndexes {
  manifest: ContextIndexManifest
  symbols: ContextSymbolIndexEntry[]
  apis: ContextApiIndexEntry[]
  search: ContextSearchIndexEntry[]
}

/** Build deterministic JSON indexes from a compiled graph. */
export function buildContextIndexes(graph: ContextGraph): ContextIndexes {
  const symbols = graph.nodes
    .filter((node) => node.type === 'code_symbol')
    .map((node) => ({
      id: node.id,
      name: node.title,
      kind: stringMeta(node.metadata, 'kind'),
      file: stringMeta(node.metadata, 'file'),
      language: stringMeta(node.metadata, 'language'),
      source: node.source.uri
    }))
    .sort(byId)

  const apis = graph.nodes
    .filter((node) => node.type === 'api_contract')
    .map((node) => ({
      id: node.id,
      method: stringMeta(node.metadata, 'method'),
      path: stringMeta(node.metadata, 'path'),
      operationId: stringMeta(node.metadata, 'operationId'),
      title: node.title,
      source: node.source.uri
    }))
    .sort(byId)

  const search = graph.nodes
    .map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      content: node.content,
      domain: node.domain,
      tags: node.tags,
      source: node.source.uri,
      text: [node.id, node.type, node.title, node.content, node.domain, ...node.tags, JSON.stringify(node.metadata)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    }))
    .sort(byId)

  return {
    manifest: {
      schemaVersion: CONTEXT_RUNTIME_SCHEMA_VERSION,
      files: {
        symbols: '.context/indexes/symbols.json',
        apis: '.context/indexes/apis.json',
        search: '.context/indexes/search.json'
      },
      counts: {
        symbols: symbols.length,
        apis: apis.length,
        search: search.length
      }
    },
    symbols,
    apis,
    search
  }
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key]
  return typeof value === 'string' ? value : undefined
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}
