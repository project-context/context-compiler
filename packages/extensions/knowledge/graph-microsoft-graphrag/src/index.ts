import { buildAdapterRuntimeInstallPlan, createContextNode, defineContextExtension, resolveAdapterExtensionPaths, slug, type GraphAdapter, type GraphAdapterManifest, type GraphBuildInput, type GraphBuildResult, type AdapterRuntimeStatus } from '@context-compiler/core/sdk'
import { join } from 'node:path'

export interface MicrosoftGraphRagRuntime {
  build(input: GraphBuildInput): Promise<GraphBuildResult>
}

export interface MicrosoftGraphRagAdapterOptions {
  runtime?: MicrosoftGraphRagRuntime
}

export const microsoftGraphRagAdapterManifest: GraphAdapterManifest = {
  id: 'microsoft-graphrag.graph-adapter',
  title: 'Microsoft GraphRAG graph adapter',
  version: '0.1.0',
  scopeKinds: ['source_group', 'content'],
  sourceGroupKinds: ['doc_bundle', 'analysis_bundle', 'domain_area'],
  inputs: ['ParsedArtifact', 'NormalizedRecord'],
  outputs: ['ContextNode', 'ContextEdge', 'ContextGraphIndexHint'],
  deterministic: false,
  requiresNetwork: true,
  stability: 'development',
  externalProjects: ['Microsoft GraphRAG'],
  runtime: {
    mode: 'managed-runtime',
    ecosystem: 'python',
    packageName: 'graphrag',
    executable: 'graphrag',
    python: {
      candidates: ['python3.13', 'python3.12', 'python3.11', 'python3'],
      minVersion: '3.11',
      maxVersionExclusive: '3.14'
    }
  }
}

export const microsoftGraphRagExtension = defineContextExtension({
  schemaVersion: 'context-extension.v1',
  id: 'extension.graph-microsoft-graphrag',
  title: 'Microsoft GraphRAG graph extension',
  version: '0.1.0',
  category: 'knowledge',
  stability: 'development',
  adapters: [{ kind: 'graph-adapter', manifest: microsoftGraphRagAdapterManifest }],
  externalProjects: ['Microsoft GraphRAG']
})

export function createMicrosoftGraphRagAdapter(options: MicrosoftGraphRagAdapterOptions = {}): GraphAdapter {
  const manifest = options.runtime
    ? { ...microsoftGraphRagAdapterManifest, runtime: undefined, metadata: { ...(microsoftGraphRagAdapterManifest.metadata ?? {}), runtime: 'injected' } }
    : microsoftGraphRagAdapterManifest
  return {
    manifest,
    async build(input: GraphBuildInput): Promise<GraphBuildResult> {
      if (options.runtime) {
        return options.runtime.build(input)
      }
      const runtimeStatus = graphRagRuntimeStatus(input.adapterConfig?.runtimeStatus)
      if (!runtimeStatus || !['installed', 'available'].includes(runtimeStatus.state)) {
        throw new MicrosoftGraphRagRuntimeMissingError(input.scope.id, input.outputDir ?? (input.rootDir ? join(input.rootDir, '.context') : '.context'))
      }
      return buildManagedGraphRagBoundary(input, runtimeStatus)
    }
  }
}

export function createMockMicrosoftGraphRagRuntime(): MicrosoftGraphRagRuntime {
  return {
    async build(input: GraphBuildInput): Promise<GraphBuildResult> {
      return buildGraphRagDocumentFacts(input, {
        artifactName: 'mock-graphrag-summary.json',
        runtimeMetadata: { runtime: 'mock' }
      })
    }
  }
}

function buildManagedGraphRagBoundary(input: GraphBuildInput, runtimeStatus: AdapterRuntimeStatus): GraphBuildResult {
  return buildGraphRagDocumentFacts(input, {
    artifactName: 'managed-graphrag-summary.json',
    runtimeMetadata: {
      runtime: 'managed',
      runtimeDir: runtimeStatus.runtimeDir,
      markerPath: runtimeStatus.markerPath,
      installedAt: runtimeStatus.installedAt
    }
  })
}

function buildGraphRagDocumentFacts(
  input: GraphBuildInput,
  options: {
    artifactName: string
    runtimeMetadata: Record<string, unknown>
  }
): GraphBuildResult {
  const rawArtifacts = input.rawArtifacts ?? []
  return {
    nodes: rawArtifacts.map((artifact) =>
      createContextNode({
        id: `GRAPHRAG-DOC-${slug(artifact.source.location?.path ?? artifact.id)}`,
        type: 'Document',
        name: artifact.source.location?.path?.split('/').pop() ?? artifact.id,
        scopeId: input.scope.id,
        sourceRefs: [artifact.source],
        properties: {
          adapterId: microsoftGraphRagAdapterManifest.id,
          corpusUnitId: input.scope.id,
          contentPreview: artifact.content.slice(0, 320),
          ...options.runtimeMetadata
        }
      })
    ),
    edges: [],
    diagnostics: [],
    artifacts: [
      {
        id: `artifact:${microsoftGraphRagAdapterManifest.id}:${slug(input.scope.id)}:${slug(options.artifactName)}`,
        path: `${input.artifactDir}/${options.artifactName}`,
        mediaType: 'application/json',
        metadata: options.runtimeMetadata
      }
    ],
    indexHints: rawArtifacts.map((artifact) => ({
      index: 'fts',
      scopeId: input.scope.id,
      nodeId: `GRAPHRAG-DOC-${slug(artifact.source.location?.path ?? artifact.id)}`,
      text: artifact.content,
      metadata: {
        adapterId: microsoftGraphRagAdapterManifest.id,
        sourcePath: artifact.source.location?.path,
        ...options.runtimeMetadata
      }
    }))
  }
}

function graphRagRuntimeStatus(value: unknown): AdapterRuntimeStatus | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const candidate = value as Partial<AdapterRuntimeStatus>
  return candidate.schemaVersion === 'context-adapter-runtime-status.v1' && candidate.adapterId === microsoftGraphRagAdapterManifest.id
    ? candidate as AdapterRuntimeStatus
    : undefined
}

export class MicrosoftGraphRagRuntimeMissingError extends Error {
  readonly code = 'adapter.runtime.missing'
  readonly installCommand = 'context adapters install microsoft-graphrag.graph-adapter'
  readonly runtimeDir: string

  constructor(scopeId: string, outputDir: string) {
    const plan = buildAdapterRuntimeInstallPlan({
      adapterId: microsoftGraphRagAdapterManifest.id,
      outputDir,
      requirement: microsoftGraphRagAdapterManifest.runtime
    })
    super(`microsoft-graphrag.graph-adapter runtime is not installed for ${scopeId}. Run: context adapters install microsoft-graphrag.graph-adapter`)
    this.name = 'MicrosoftGraphRagRuntimeMissingError'
    this.runtimeDir = plan?.runtimeDir ?? resolveAdapterExtensionPaths({ adapterId: microsoftGraphRagAdapterManifest.id, outputDir }).runtimeDir
  }
}
