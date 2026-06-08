import type { ContextGraph, ContextIndexManifest, ContextSourceInventory } from '../contracts/index.js'
import { nodeContent, nodeStringProperty, sourceUri } from '../graph/model.js'
import { buildGraphScopes } from '../graph/scopes.js'
import { CONTEXT_RUNTIME_SCHEMA_VERSION } from './schema.js'

export interface ContextSymbolIndexEntry {
  id: string
  name: string
  kind?: string
  file?: string
  language?: string
  sourceUri: string
}

export interface ContextApiIndexEntry {
  id: string
  method?: string
  path?: string
  operationId?: string
  name: string
  sourceUri: string
}

export interface ContextTextIndexEntry {
  id: string
  type: string
  name: string
  domain?: string
  tags: string[]
  sourceUri: string
  text: string
}

export interface ContextGraphIndexEntry {
  id: string
  type: string
  name: string
  domain?: string
  module?: string
  status: string
  authority: string
  confidence: string
  fingerprint: string
  subgraph: string
}

export interface ContextFingerprintIndexEntry {
  id: string
  ownerId: string
  fingerprint: string
  sourceUris: string[]
}

export interface ContextIndexes {
  manifest: ContextIndexManifest
  graph: ContextGraphIndexEntry[]
  symbols: ContextSymbolIndexEntry[]
  apis: ContextApiIndexEntry[]
  docs: ContextTextIndexEntry[]
  tests: ContextTextIndexEntry[]
  runtime: ContextTextIndexEntry[]
  fts: ContextTextIndexEntry[]
  fingerprints: ContextFingerprintIndexEntry[]
  scopes: ContextScopedIndexes[]
}

export interface ContextScopedIndexes {
  scope: ReturnType<typeof buildGraphScopes>['scopes'][number]
  indexes: Omit<ContextIndexes, 'scopes'>
}

export interface BuildContextIndexesOptions {
  sourceInventory?: ContextSourceInventory
  includeScopes?: boolean
}

/** Build deterministic JSON indexes from a compiled graph. */
export function buildContextIndexes(graph: ContextGraph, options: BuildContextIndexesOptions = {}): ContextIndexes {
  const base = buildFlatContextIndexes(graph, {
    graph: '.context/indexes/global/graph.sqlite',
    symbols: '.context/indexes/global/symbols.sqlite',
    apis: '.context/indexes/global/api.sqlite',
    docs: '.context/indexes/global/docs.sqlite',
    tests: '.context/indexes/global/tests.sqlite',
    runtime: '.context/indexes/global/runtime.sqlite',
    fts: '.context/indexes/global/fts.sqlite',
    fingerprints: '.context/indexes/global/fingerprints.sqlite',
    scopes: '.context/indexes/scopes'
  })
  const scopes =
    options.includeScopes === false
      ? []
      : buildGraphScopes(graph, options.sourceInventory).graphs.map(({ scope, graph: scopedGraph }) => ({
          scope,
          indexes: buildFlatContextIndexes(scopedGraph, {
            graph: scope.indexRefs.graph,
            symbols: scope.indexRefs.symbols,
            apis: scope.indexRefs.apis,
            docs: scope.indexRefs.docs,
            tests: scope.indexRefs.tests,
            runtime: scope.indexRefs.runtime,
            fts: scope.indexRefs.fts,
            fingerprints: scope.indexRefs.fingerprints,
            scopes: '.context/indexes/scopes'
          })
        }))

  return {
    ...base,
    manifest: {
      ...base.manifest,
      counts: {
        ...base.manifest.counts,
        scopes: scopes.length
      }
    },
    scopes
  }
}

function buildFlatContextIndexes(graph: ContextGraph, files: ContextIndexManifest['files']): Omit<ContextIndexes, 'scopes'> {
  const graphIndex = graph.nodes
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      domain: node.domain,
      module: node.module,
      status: node.status,
      authority: node.authority,
      confidence: String(node.confidence),
      fingerprint: node.fingerprint,
      subgraph: subgraphForNodeType(node.type)
    }))
    .sort(byId)

  const symbols = graph.nodes
    .filter((node) => node.type === 'CodeSymbol')
    .map((node) => ({
      id: node.id,
      name: node.name,
      kind: nodeStringProperty(node, 'kind'),
      file: nodeStringProperty(node, 'file'),
      language: nodeStringProperty(node, 'language'),
      sourceUri: sourceUri(node) ?? ''
    }))
    .sort(byId)

  const apis = graph.nodes
    .filter((node) => node.type === 'APIEndpoint')
    .map((node) => ({
      id: node.id,
      method: nodeStringProperty(node, 'method'),
      path: nodeStringProperty(node, 'path'),
      operationId: nodeStringProperty(node, 'operationId'),
      name: node.name,
      sourceUri: sourceUri(node) ?? ''
    }))
    .sort(byId)

  const docs = textEntries(graph, (type) => DOCUMENT_TYPES.has(type))
  const tests = textEntries(graph, (type) => TEST_TYPES.has(type))
  const runtime = textEntries(graph, (type) => RUNTIME_TYPES.has(type))
  const fts = textEntries(graph, (type) => !PROVENANCE_TYPES.has(type))
  const fingerprints = graph.nodes
    .map((node) => ({
      id: `FP-${node.id}`,
      ownerId: node.id,
      fingerprint: node.fingerprint,
      sourceUris: node.sourceRefs.map((sourceRef) => sourceRef.uri)
    }))
    .sort(byId)

  return {
    manifest: {
      schemaVersion: CONTEXT_RUNTIME_SCHEMA_VERSION,
      files,
      counts: {
        graph: graphIndex.length,
        symbols: symbols.length,
        apis: apis.length,
        docs: docs.length,
        tests: tests.length,
        runtime: runtime.length,
        fts: fts.length,
        fingerprints: fingerprints.length,
        scopes: 0
      }
    },
    graph: graphIndex,
    symbols,
    apis,
    docs,
    tests,
    runtime,
    fts,
    fingerprints
  }
}

function textEntries(graph: ContextGraph, predicate: (type: string) => boolean): ContextTextIndexEntry[] {
  return graph.nodes
    .filter((node) => predicate(node.type))
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      domain: node.domain,
      tags: node.tags,
      sourceUri: sourceUri(node) ?? '',
      text: [node.id, node.type, node.name, nodeContent(node), node.domain, ...node.tags, JSON.stringify(node.properties)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    }))
    .sort(byId)
}

function subgraphForNodeType(type: string): string {
  if (type === 'CodeSymbol' || type === 'Class' || type === 'Interface' || type === 'Method' || type === 'File') return 'code'
  if (type === 'APIEndpoint' || type === 'RequestDTO' || type === 'ResponseDTO' || type === 'ExternalAPI') return 'api'
  if (TEST_TYPES.has(type)) return 'test'
  if (type.startsWith('UI') || type === 'UserFlow' || type === 'Interaction') return 'ui'
  if (RUNTIME_TYPES.has(type)) return 'runtime'
  if (type === 'Diagnostic' || type === 'ContextPolicy' || type === 'ContextHealth') return 'governance'
  if (DOCUMENT_TYPES.has(type)) return 'document'
  return 'semantic'
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

const DOCUMENT_TYPES = new Set([
  'Document',
  'Section',
  'Requirement',
  'BusinessRule',
  'AcceptanceCriteria',
  'Decision',
  'Risk',
  'ChangeLog',
  'GlossaryTerm',
  'Procedure',
  'RunbookStep'
])

const TEST_TYPES = new Set(['TestPlan', 'TestCase', 'TestSuite', 'TestMethod', 'Fixture', 'TestData', 'Assertion'])

const RUNTIME_TYPES = new Set([
  'Metric',
  'RuntimeConfig',
  'ConfigItem',
  'FeatureFlag',
  'DatabaseSchema',
  'DatabaseTable',
  'LogPattern',
  'TraceSpan',
  'Deployment',
  'Release',
  'Incident',
  'Environment'
])

const PROVENANCE_TYPES = new Set(['Source', 'SourceSnapshot'])
