import type {
  ContextEdge,
  ContextGraphScope,
  ContextGraphAdapterRef,
  ContextNode,
  Diagnostic
} from '../contracts/graph.js'
import type {
  ContextSourceInventory
} from '../contracts/sources.js'
import type {
  DocumentExtractorAdapter,
  GraphAdapterArtifact,
  GraphAdapter,
  ContextGraphIndexHint,
  GraphAdapterManifest,
  GraphBuildInput,
  GraphBuildResult,
  SourceParserAdapter,
  AdapterRuntimeRequirement
} from '../contracts/adapters.js'
import type { ContextDistribution } from '../contracts/pipeline.js'
import { createContextEdge, createContextNode, normalizeContextNodeType } from './model.js'

export interface NormalizeGraphBuildResultOptions {
  adapterId: string
  scopeId?: string
}

export interface NormalizedGraphBuildResult {
  nodes: ContextNode[]
  edges: ContextEdge[]
  diagnostics?: Diagnostic[]
  indexHints?: ContextGraphIndexHint[]
  artifacts?: GraphAdapterArtifact[]
  adapterRefs?: ContextGraphAdapterRef[]
}

export interface AdapterRegistryInput {
  sourceParsers?: SourceParserAdapter[]
  documentExtractors?: DocumentExtractorAdapter[]
  graphAdapters?: GraphAdapter[]
}

export interface ValidateGraphBuildResultOptions {
  manifest: GraphAdapterManifest
  input: GraphBuildInput
}

export class ContextAdapterRegistry {
  readonly sourceParsers: SourceParserAdapter[]
  readonly documentExtractors: DocumentExtractorAdapter[]
  readonly graphAdapters: GraphAdapter[]

  constructor(input: AdapterRegistryInput = {}) {
    this.sourceParsers = input.sourceParsers ?? []
    this.documentExtractors = input.documentExtractors ?? []
    this.graphAdapters = dedupeGraphAdapters(input.graphAdapters ?? [])
  }

  graphAdaptersForScope(scope: ContextGraphScope, sourceInventory?: ContextSourceInventory): GraphAdapter[] {
    const group = scope.sourceGroupId ? sourceInventory?.groups?.find((candidate) => candidate.id === scope.sourceGroupId) : undefined
    return this.graphAdapters.filter((adapter) => {
      const manifest = adapter.manifest
      if (!manifest.scopeKinds.includes(scope.kind)) {
        return false
      }
      if (manifest.sourceGroupKinds && manifest.sourceGroupKinds.length > 0) {
        return Boolean(group && manifest.sourceGroupKinds.includes(group.kind))
      }
      return true
    })
  }
}

export function createAdapterRegistry(input: AdapterRegistryInput = {}): ContextAdapterRegistry {
  return new ContextAdapterRegistry(input)
}

export function adapterRegistryFromDistribution(distribution: ContextDistribution): ContextAdapterRegistry {
  return createAdapterRegistry({
    sourceParsers: distribution.sourceParsers,
    documentExtractors: distribution.documentExtractors,
    graphAdapters: distribution.graphAdapters
  })
}

/** Validate the minimum stable contract every graph adapter must declare. */
export function validateGraphAdapterManifest(manifest: GraphAdapterManifest): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!manifest.id || manifest.id.trim().length === 0) {
    diagnostics.push(adapterDiagnostic('id', 'Graph adapter manifest must declare a stable id.'))
  }
  if (!manifest.title || manifest.title.trim().length === 0) {
    diagnostics.push(adapterDiagnostic('title', `Graph adapter "${manifest.id || 'unknown'}" must declare a title.`))
  }
  if (!manifest.version || manifest.version.trim().length === 0) {
    diagnostics.push(adapterDiagnostic('version', `Graph adapter "${manifest.id || 'unknown'}" must declare a version.`))
  }
  if (manifest.scopeKinds.length === 0) {
    diagnostics.push(adapterDiagnostic('scopeKinds', `Graph adapter "${manifest.id || 'unknown'}" must support at least one scope kind.`))
  }
  if (manifest.inputs.length === 0 || manifest.outputs.length === 0) {
    diagnostics.push(adapterDiagnostic('io', `Graph adapter "${manifest.id || 'unknown'}" must declare inputs and outputs.`))
  }
  diagnostics.push(...validateAdapterRuntimeRequirement(manifest.id || 'unknown', manifest.runtime))
  return diagnostics
}

/** Validate one adapter result before canonical facts are merged into the graph. */
export function validateGraphBuildResult(result: GraphBuildResult, options: ValidateGraphBuildResultOptions): Diagnostic[] {
  const diagnostics = [...validateGraphAdapterManifest(options.manifest)]
  const scope = options.input.scope
  if (!options.manifest.scopeKinds.includes(scope.kind)) {
    diagnostics.push(adapterDiagnostic(
      'scope',
      `Graph adapter "${options.manifest.id}" does not support scope kind ${scope.kind}.`,
      'graph-adapter.result.unsupported-scope'
    ))
  }

  const nodeIds = new Set(options.input.graph.nodes.map((node) => node.id))
  const seenNodeIds = new Set<string>()
  for (const node of result.nodes) {
    if (seenNodeIds.has(node.id)) {
      diagnostics.push(adapterDiagnostic(
        'node.id',
        `Graph adapter "${options.manifest.id}" emitted duplicate node id ${node.id}.`,
        'graph-adapter.result.duplicate-id'
      ))
    }
    seenNodeIds.add(node.id)
    nodeIds.add(node.id)
    if (node.type !== normalizeContextNodeType(node.type)) {
      diagnostics.push(adapterDiagnostic(
        'node.type',
        `Graph adapter "${options.manifest.id}" emitted non-canonical node type ${node.type}.`,
        'graph-adapter.result.non-canonical-node-type'
      ))
    }
    if (!node.sourceRefs || node.sourceRefs.length === 0) {
      diagnostics.push(adapterDiagnostic(
        'node.sourceRefs',
        `Graph adapter "${options.manifest.id}" emitted node ${node.id} without sourceRefs.`,
        'graph-adapter.result.missing-source-refs'
      ))
    }
  }

  const seenEdgeIds = new Set<string>()
  for (const edge of result.edges) {
    if (seenEdgeIds.has(edge.id)) {
      diagnostics.push(adapterDiagnostic(
        'edge.id',
        `Graph adapter "${options.manifest.id}" emitted duplicate edge id ${edge.id}.`,
        'graph-adapter.result.duplicate-id'
      ))
    }
    seenEdgeIds.add(edge.id)
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      diagnostics.push(adapterDiagnostic(
        'edge.endpoint',
        `Graph adapter "${options.manifest.id}" emitted edge ${edge.id} with missing endpoint.`,
        'graph-adapter.result.missing-edge-endpoint'
      ))
    }
  }

  const artifactDir = options.input.artifactDir
  for (const artifact of result.artifacts ?? []) {
    if (artifactDir && !artifact.path.startsWith(`${artifactDir}/`) && artifact.path !== artifactDir) {
      diagnostics.push(adapterDiagnostic(
        'artifact.path',
        `Graph adapter "${options.manifest.id}" emitted artifact outside adapter artifactDir: ${artifact.path}.`,
        'graph-adapter.result.invalid-artifact-path'
      ))
    }
  }

  return dedupeDiagnostics(diagnostics)
}

/** Normalize external adapter output into a canonical graph patch. */
export function normalizeGraphBuildResult(result: GraphBuildResult, options: NormalizeGraphBuildResultOptions): NormalizedGraphBuildResult {
  return {
    nodes: result.nodes.map((node) =>
      createContextNode({
        ...node,
        scopeId: node.scopeId ?? options.scopeId,
        properties: {
          ...node.properties,
          adapterId: options.adapterId,
          scopeId: node.properties.scopeId ?? options.scopeId
        }
      })
    ),
    edges: result.edges.map((edge) =>
      createContextEdge({
        ...edge,
        linker: edge.linker === 'unknown' ? options.adapterId : edge.linker,
        scopeId: edge.scopeId ?? options.scopeId,
        properties: {
          ...edge.properties,
          adapterId: options.adapterId,
          scopeId: edge.properties.scopeId ?? options.scopeId
        }
      })
    ),
    diagnostics: result.diagnostics ?? [],
    indexHints: result.indexHints ?? [],
    artifacts: result.artifacts ?? [],
    adapterRefs: result.adapterRefs ?? [{ adapterId: options.adapterId, role: 'semantic-graph-builder' }]
  }
}

function dedupeGraphAdapters(adapters: GraphAdapter[]): GraphAdapter[] {
  const seen = new Set<string>()
  const deduped: GraphAdapter[] = []
  for (const adapter of adapters) {
    if (seen.has(adapter.manifest.id)) {
      throw new Error(`Duplicate graph adapter id: ${adapter.manifest.id}`)
    }
    seen.add(adapter.manifest.id)
    deduped.push(adapter)
  }
  return deduped
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic])).values()]
}

function adapterDiagnostic(field: string, message: string, type = 'graph-adapter.invalid-manifest'): Diagnostic {
  return {
    id: `DIAG-${type.replace(/[^A-Za-z0-9_.:-]+/g, '-')}-${field.replace(/[^A-Za-z0-9_.:-]+/g, '-')}`,
    type,
    severity: 'error',
    message,
    relatedNodes: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    properties: { field }
  }
}

export function validateAdapterRuntimeRequirement(adapterId: string, requirement: AdapterRuntimeRequirement | undefined): Diagnostic[] {
  if (!requirement) {
    return []
  }
  const diagnostics: Diagnostic[] = []
  if (requirement.mode === 'dependency' && !requirement.packageName) {
    diagnostics.push(adapterDiagnostic('runtime.packageName', `Adapter "${adapterId}" dependency runtime must declare packageName.`, 'adapter.runtime.invalid-manifest'))
  }
  if (requirement.mode === 'managed-runtime') {
    if (!requirement.packageName && (!requirement.installCommands || requirement.installCommands.length === 0)) {
      diagnostics.push(adapterDiagnostic('runtime.packageName', `Adapter "${adapterId}" managed runtime must declare packageName or installCommands.`, 'adapter.runtime.invalid-manifest'))
    }
    if (requirement.installCommands) {
      for (const [index, command] of requirement.installCommands.entries()) {
        if (!command.command || command.args.some((arg) => typeof arg !== 'string')) {
          diagnostics.push(adapterDiagnostic(`runtime.installCommands.${index}`, `Adapter "${adapterId}" managed runtime install command ${index} is invalid.`, 'adapter.runtime.invalid-manifest'))
        }
      }
    }
  }
  if (requirement.mode === 'configured-runtime' && !requirement.configuredEnvVar) {
    diagnostics.push(adapterDiagnostic('runtime.configuredEnvVar', `Adapter "${adapterId}" configured runtime must declare configuredEnvVar.`, 'adapter.runtime.invalid-manifest'))
  }
  return diagnostics
}
