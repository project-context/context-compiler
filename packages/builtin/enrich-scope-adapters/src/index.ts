import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildGraphScopes, createAdapterRegistry, normalizeGraphBuildResult, scopeDirName, validateGraphBuildResult } from '@context-compiler/core/graph'
import { defineComponent, ensureAdapterRuntimeStatus, type ContextComponent, type ContextGraph, type ContextSourceInventory, type ContextSourceInventoryEntry, type GraphAdapter, type GraphAdapterArtifact, type AdapterRuntimeStatus, type GraphBuildInput, type RawArtifact } from '@context-compiler/core/sdk'

export interface ScopeAdaptersEnrichOptions {
  graphAdapters?: GraphAdapter[]
}

/** Execute registered Graph-of-Graphs adapters against source group scopes. */
export function createScopeAdaptersEnrichComponent(options: ScopeAdaptersEnrichOptions = {}): ContextComponent {
  const registry = createAdapterRegistry({ graphAdapters: options.graphAdapters ?? [] })
  return defineComponent({
    manifest: {
      id: 'enrich.scope-adapters',
      stage: 'enrich',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph', 'context-source-inventory', 'graph-adapter'],
      outputs: ['context-node', 'context-edge', 'graph-adapter-artifact', 'context-graph-index-hint'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state, context) {
      const sourceInventory = isSourceInventory(state.artifacts.sourceInventory) ? state.artifacts.sourceInventory : undefined
      if (!sourceInventory || registry.graphAdapters.length === 0) {
        return {}
      }

      const scoped = buildGraphScopes(state.graph, sourceInventory)
      const facts = []
      const edges = []
      const diagnostics = []
      const graphAdapterArtifacts: GraphAdapterArtifact[] = []
      const graphAdapterIndexHints = []
      const graphAdapterResults = []
      const graphAdapterRuntimeStatuses: AdapterRuntimeStatus[] = []

      for (const { scope, graph: scopeGraph } of scoped.graphs.filter((entry) => entry.scope.kind === 'source_group')) {
        const adapters = registry.graphAdaptersForScope(scope, sourceInventory)
        if (adapters.length === 0) {
          continue
        }
        for (const adapter of adapters) {
          const sourceEntries = sourceEntriesForScope(sourceInventory.entries, scope.path, adapter)
          const rawArtifacts = rawArtifactsForEntries(state.rawArtifacts, sourceEntries)
          if (sourceEntries.length === 0 || rawArtifacts.length === 0) {
            continue
          }
          const artifactDir = `.context/extensions/${adapter.manifest.id}/artifacts/${scopeDirName(scope.id)}`
          const runtimeStatus = await ensureAdapterRuntimeStatus({
            adapterId: adapter.manifest.id,
            outputDir: context.outputDir,
            requirement: adapter.manifest.runtime,
            onProgress: context.onProgress
          })
          graphAdapterRuntimeStatuses.push(runtimeStatus)
          if (runtimeStatus.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            diagnostics.push(...runtimeStatus.diagnostics)
            continue
          }
          const input: GraphBuildInput = {
            scope,
            graph: state.graph,
            scopeGraph,
            sourceInventory,
            sourceEntries,
            rawArtifacts,
            parsedArtifacts: state.parsedArtifacts,
            normalizedRecords: state.normalizedRecords,
            config: context.config,
            rootDir: context.rootDir,
            outputDir: context.outputDir,
            artifactDir,
            artifacts: state.artifacts,
            adapterConfig: {
              runtimeStatus
            }
          }
          const result = await adapter.build(input)
          const validationDiagnostics = validateGraphBuildResult(result, { manifest: adapter.manifest, input })
          diagnostics.push(...validationDiagnostics)
          if (validationDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            continue
          }
          const normalized = normalizeGraphBuildResult(result, { adapterId: adapter.manifest.id, scopeId: scope.id })
          facts.push(...normalized.nodes)
          edges.push(...normalized.edges)
          diagnostics.push(...(normalized.diagnostics ?? []))
          graphAdapterArtifacts.push(...(normalized.artifacts ?? []))
          graphAdapterIndexHints.push(...(normalized.indexHints ?? []))
          graphAdapterResults.push({
            adapterId: adapter.manifest.id,
            scopeId: scope.id,
            nodes: normalized.nodes.length,
            edges: normalized.edges.length,
            artifacts: normalized.artifacts ?? []
          })
          await writeAdapterSummary(context.outputDir, artifactDir, adapter.manifest.id, scope.id, normalized, runtimeStatus)
        }
      }

      return {
        facts,
        edges,
        diagnostics,
        artifacts: {
          graphAdapterArtifacts,
          graphAdapterIndexHints,
          graphAdapterResults,
          graphAdapterRuntimeStatuses
        }
      }
    }
  })
}

async function writeAdapterSummary(
  outputDir: string,
  artifactDir: string,
  adapterId: string,
  scopeId: string,
  result: ReturnType<typeof normalizeGraphBuildResult>,
  runtimeStatus?: AdapterRuntimeStatus
): Promise<void> {
  const dir = join(outputDir, artifactDir.replace(/^\.context\//, ''))
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'adapter-result-summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 'context-graph-adapter-summary.v1',
        adapterId,
        scopeId,
        nodes: result.nodes.length,
        edges: result.edges.length,
        indexHints: result.indexHints?.length ?? 0,
        artifacts: result.artifacts ?? [],
        runtimeStatus
      },
      null,
      2
    )}\n`
  )
}

function sourceEntriesForScope(entries: ContextSourceInventoryEntry[], scopePath: string | undefined, adapter: GraphAdapter): ContextSourceInventoryEntry[] {
  if (!scopePath) {
    return []
  }
  return entries.filter((entry) => entry.status === 'routed' && routeAllowedForAdapter(entry.route, adapter) && pathWithin(entry.path, scopePath))
}

function routeAllowedForAdapter(route: ContextSourceInventoryEntry['route'], adapter: GraphAdapter): boolean {
  const sourceGroupKinds = adapter.manifest.sourceGroupKinds ?? []
  if (sourceGroupKinds.includes('repository') || sourceGroupKinds.includes('test_bundle')) {
    return route === 'code'
  }
  if (sourceGroupKinds.includes('doc_bundle') || sourceGroupKinds.includes('analysis_bundle') || sourceGroupKinds.includes('domain_area')) {
    return route === 'markdown'
  }
  if (sourceGroupKinds.includes('api_bundle')) {
    return route === 'openapi'
  }
  return route === 'markdown' || route === 'code' || route === 'openapi'
}

function rawArtifactsForEntries(rawArtifacts: RawArtifact[], entries: ContextSourceInventoryEntry[]): RawArtifact[] {
  const paths = new Set(entries.map((entry) => entry.path))
  return rawArtifacts.filter((artifact) => {
    const path = artifact.source.location?.path
    return typeof path === 'string' && paths.has(path)
  })
}

function isSourceInventory(value: unknown): value is ContextSourceInventory {
  return Boolean(value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 'context-source-inventory.v1')
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}
