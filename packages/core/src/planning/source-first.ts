import type {
  ContextAdapterPlan,
  ContextGraph,
  ContextGraphAdapterRef,
  ContextProjectConfig,
  ContextScopeBuildPlan,
  ContextSourceFirstPlans,
  ContextSourceGroupPlan,
  ContextSourceInventory,
  ContextSourceInventoryEntry,
  ContextSourceTriageResult,
  ContextWorkspaceGraphPlan
} from '../contracts/index.js'
import { buildGraphScopes } from '../graph/scopes.js'
import { fingerprintValue } from '../graph/model.js'

export interface BuildSourceFirstPlansOptions {
  graph: ContextGraph
  sourceInventory: ContextSourceInventory
  config: ContextProjectConfig
  generatedAt?: string
}

/** Build the source-first control-plane plans that drive Graph-of-Graphs execution. */
export function buildSourceFirstPlans(options: BuildSourceFirstPlansOptions): ContextSourceFirstPlans {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const scoped = buildGraphScopes(options.graph, options.sourceInventory)
  const sourceGroups = options.sourceInventory.groups ?? []
  const scopeByGroupId = new Map(
    scoped.scopes
      .filter((scope) => scope.kind === 'source_group' && scope.sourceGroupId)
      .map((scope) => [scope.sourceGroupId as string, scope])
  )

  const triage = buildTriagePlan(options.sourceInventory, generatedAt)
  const groupPlan: ContextSourceGroupPlan = {
    schemaVersion: 'context-source-group-plan.v1',
    generatedAt,
    groups: sourceGroups.map((group) => ({
      id: group.id,
      sourceName: group.sourceName,
      path: group.path,
      title: group.title,
      kind: group.kind,
      boundaryMode: group.boundaryMode,
      summary: group.summary,
      decisionSource: group.decisionSource,
      confidence: group.confidence,
      adapterPlan: scopeByGroupId.get(group.id)?.adapterRefs ?? [{ adapterId: 'builtin.source-inventory', role: 'inventory' }]
    }))
  }

  const workspaceGraph: ContextWorkspaceGraphPlan = {
    schemaVersion: 'context-workspace-graph-plan.v1',
    generatedAt,
    rootScopeId: 'scope:project',
    scopeDAG: scoped.scopes.map((scope) => ({
      scopeId: scope.id,
      kind: scope.kind,
      parentScopeId: scope.parentScopeId,
      rootNodeId: scope.rootNodeId,
      sourceGroupId: scope.sourceGroupId,
      path: scope.path,
      title: scope.title,
      boundaryMode: scope.boundaryMode,
      adapters: scope.adapterRefs
    })),
    skeletonNodes: options.graph.nodes
      .filter((node) => node.type === 'Project' || node.type === 'Source' || node.type === 'SourceGroup')
      .map((node) => ({
        id: node.id,
        type: node.type,
        name: node.name,
        scopeId: node.scopeId,
        subgraphRef: node.subgraphRef,
        properties: node.properties
      })),
    weakRelations: options.graph.edges
      .filter((edge) => edge.type === 'related_to_group' || edge.type === 'references_source_group' || edge.type === 'materializes_subgraph' || edge.type === 'has_child_scope')
      .map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        type: edge.type,
        confidence: edge.confidence,
        evidence: edge.evidence,
        properties: edge.properties
      }))
  }

  const scopeBuild: ContextScopeBuildPlan = {
    schemaVersion: 'context-scope-build-plan.v1',
    generatedAt,
    scopes: scoped.scopes.map((scope) => ({
      scopeId: scope.id,
      kind: scope.kind,
      parentScopeId: scope.parentScopeId,
      sourceGroupId: scope.sourceGroupId,
      path: scope.path,
      boundaryMode: scope.boundaryMode,
      adapters: scope.adapterRefs,
      inputs: inputsForScope(options.sourceInventory, scope.path),
      outputs: ['ContextGraphScope', 'ContextNode', 'ContextEdge', 'ContextGraphIndexHint'],
      cacheKey: fingerprintValue({
        scopeId: scope.id,
        path: scope.path,
        adapters: scope.adapterRefs,
        inputHashes: inputHashesForScope(options.sourceInventory, scope.path)
      }),
      freshness: scope.freshness
    }))
  }

  return {
    triage,
    sourceGroups: groupPlan,
    workspaceGraph,
    scopeBuild,
    adapterPlan: buildAdapterPlan(scopeBuild, generatedAt)
  }
}

function buildTriagePlan(sourceInventory: ContextSourceInventory, generatedAt: string): ContextSourceTriageResult {
  const entries = sourceInventory.entries.map((entry) => ({
    sourceInventoryId: entry.id,
    path: entry.path,
    route: entry.route,
    status: entry.status,
    action: triageAction(entry),
    adapterNeeded: needsAdapter(entry),
    unsupportedReason: entry.unsupportedReason,
    mediaType: entry.mediaType
  }))
  return {
    schemaVersion: 'context-source-triage.v1',
    generatedAt,
    summary: {
      files: sourceInventory.entries.length,
      routed: entries.filter((entry) => entry.action === 'route').length,
      inventoryOnly: entries.filter((entry) => entry.action === 'inventory').length,
      unsupported: sourceInventory.entries.filter((entry) => entry.status === 'unsupported').length,
      skipped: sourceInventory.entries.filter((entry) => entry.status === 'skipped').length,
      adapterNeeded: entries.filter((entry) => entry.adapterNeeded).length
    },
    entries,
    diagnostics: []
  }
}

function triageAction(entry: ContextSourceInventoryEntry): ContextSourceTriageResult['entries'][number]['action'] {
  if (needsAdapter(entry)) return 'needs-adapter'
  if (entry.status === 'skipped') return 'skip'
  if (entry.status === 'inventory_only') return 'inventory'
  return 'route'
}

function needsAdapter(entry: ContextSourceInventoryEntry): boolean {
  return entry.status === 'unsupported' && (entry.unsupportedReason === 'adapter-not-configured' || entry.unsupportedReason === undefined)
}

function inputsForScope(sourceInventory: ContextSourceInventory, path: string | undefined): string[] {
  if (!path) {
    return ['ContextSourceInventory']
  }
  return sourceInventory.entries.filter((entry) => pathWithin(entry.path, path)).map((entry) => entry.id)
}

function inputHashesForScope(sourceInventory: ContextSourceInventory, path: string | undefined): string[] {
  if (!path) {
    return sourceInventory.entries.map((entry) => entry.hash)
  }
  return sourceInventory.entries.filter((entry) => pathWithin(entry.path, path)).map((entry) => entry.hash)
}

function buildAdapterPlan(scopeBuild: ContextScopeBuildPlan, generatedAt: string): ContextAdapterPlan {
  const adapters = new Map<string, ContextGraphAdapterRef & { scopeIds: string[]; inputs: string[]; outputs: string[] }>()
  for (const scope of scopeBuild.scopes) {
    for (const adapter of scope.adapters) {
      const existing = adapters.get(adapter.adapterId) ?? {
        ...adapter,
        scopeIds: [],
        inputs: [],
        outputs: []
      }
      existing.scopeIds.push(scope.scopeId)
      existing.inputs.push(...scope.inputs)
      existing.outputs.push(...scope.outputs)
      adapters.set(adapter.adapterId, existing)
    }
  }
  return {
    schemaVersion: 'context-adapter-plan.v1',
    generatedAt,
    adapters: [...adapters.values()].map((adapter) => ({
      ...adapter,
      scopeIds: [...new Set(adapter.scopeIds)].sort(),
      inputs: [...new Set(adapter.inputs)].sort(),
      outputs: [...new Set(adapter.outputs)].sort()
    }))
  }
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}
