import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ContextEdge,
  ContextGraph,
  ContextGraphScope,
  ContextGraphScopeManifest,
  ContextNode,
  Diagnostic,
  GraphDrillBudget,
  GraphViewerElement,
  GraphViewerInspectResult,
  GraphViewerOverview,
  GraphViewerSearchResult
} from '../contracts/index.js'
import { createDiagnostic } from '../diagnostics/index.js'
import { loadGraphFiles } from '../graph/index.js'
import { scopeIdForPackage, scopeIdForSourceGroup } from '../graph/scopes.js'
import { explainGraphFact } from './graph-facts.js'
import { searchContextIndex } from './search-index.js'
import { expandGraphTarget, getLayeredSourceTrace } from './scope-drilldown.js'

export interface GraphViewerOverviewOptions {
  outputDir: string
  scopeId?: string
  limitNodes?: number
  limitEdges?: number
  limitSourceRefs?: number
  limitEvidence?: number
}

export interface GraphViewerInspectOptions {
  outputDir: string
  targetId: string
  depth?: number
  limitNodes?: number
  limitEdges?: number
  limitSourceRefs?: number
  limitEvidence?: number
}

export interface GraphViewerSearchOptions {
  outputDir: string
  query: string
  scopeId?: string
  limit?: number
}

const DEFAULT_OVERVIEW_BUDGET = {
  nodes: 250,
  edges: 400,
  sourceRefs: 5,
  evidence: 5
}

const HIDDEN_OVERVIEW_NODE_TYPES = new Set(['Source', 'SourceSnapshot'])
const IMPORTANT_EDGE_TYPES = new Set(['contains_group', 'materializes_subgraph', 'has_child_scope', 'related_to_group', 'calls', 'imports', 'references', 'contains', 'derived_from'])

export async function buildGraphViewerOverview(options: GraphViewerOverviewOptions): Promise<GraphViewerOverview> {
  const graph = await loadGraphFiles(options.outputDir)
  const manifest = await readOptionalScopeManifest(options.outputDir)
  const budget = viewerBudget(options)
  if (manifest) {
    return buildGraphOfGraphsOverview(graph, manifest, budget, options)
  }
  const selectedNodes = selectOverviewNodes(graph, budget.nodes ?? DEFAULT_OVERVIEW_BUDGET.nodes)
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id))
  const selectedEdges = graph.edges
    .filter((edge) => selectedNodeIds.has(edge.from) && selectedNodeIds.has(edge.to))
    .filter((edge) => IMPORTANT_EDGE_TYPES.has(edge.type))
    .sort(edgeSort)
    .slice(0, budget.edges ?? DEFAULT_OVERVIEW_BUDGET.edges)

  return {
    schemaVersion: 'context-graph-viewer-overview.v1',
    scopeId: options.scopeId,
    elements: {
      nodes: selectedNodes.map((node) => nodeToViewerElement(node, graph, budget)),
      edges: selectedEdges.map((edge) => edgeToViewerElement(edge, graph, budget))
    },
    stats: {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      visibleNodes: selectedNodes.length,
      visibleEdges: selectedEdges.length
    },
    budget,
    omitted: {
      nodes: Math.max(0, graph.nodes.filter((node) => !HIDDEN_OVERVIEW_NODE_TYPES.has(node.type)).length - selectedNodes.length),
      edges: Math.max(0, graph.edges.length - selectedEdges.length),
      childScopes: 0,
      sourceRefs: omittedSourceRefs(selectedNodes, budget.sourceRefs ?? DEFAULT_OVERVIEW_BUDGET.sourceRefs),
      evidence: omittedEvidence(selectedEdges, budget.evidence ?? DEFAULT_OVERVIEW_BUDGET.evidence)
    },
    diagnostics: graph.diagnostics
  }
}

function buildGraphOfGraphsOverview(
  graph: ContextGraph,
  manifest: ContextGraphScopeManifest,
  budget: GraphDrillBudget,
  options: GraphViewerOverviewOptions
): GraphViewerOverview {
  const projectScope = manifest.scopes.find((scope) => scope.id === 'scope:project') ?? manifest.scopes[0]
  const maxNodes = budget.nodes ?? DEFAULT_OVERVIEW_BUDGET.nodes
  const packageScopes = new Map(manifest.scopes.filter((scope) => scope.kind === 'package').map((scope) => [scope.rootNodeId, scope]))
  const packageNodes = graph.nodes
    .filter((node) => node.type === 'Package')
    .sort(packageNodeSort)
    .slice(0, Math.max(0, maxNodes - 1))
  const elements = projectScope ? [scopeToViewerElement(projectScope, graph)] : []
  const edges: GraphViewerElement[] = []

  for (const node of packageNodes) {
    elements.push(packageNodeToViewerElement(node, graph, packageScopes.get(node.id)))
  }

  const packageIds = new Set(packageNodes.map((node) => node.id))
  for (const edge of graph.edges.filter((candidate) => candidate.type === 'contains_package' && packageIds.has(candidate.to))) {
    if (projectScope) {
      edges.push(viewerEdge({
        id: edge.id,
        type: edge.type,
        source: projectScope.id,
        target: edge.to,
        label: 'contains_package',
        status: edge.status,
        data: {
          linker: edge.linker,
          properties: edge.properties
        }
      }))
    }
  }
  if (projectScope) {
    const connected = new Set(edges.map((edge) => edge.target).filter((target): target is string => typeof target === 'string'))
    for (const node of packageNodes) {
      if (connected.has(node.id)) continue
      edges.push(viewerEdge({
        id: `VIEWER-${projectScope.id}-contains-package-${node.id}`,
        type: 'contains_package',
        source: projectScope.id,
        target: node.id,
        label: 'contains_package',
        status: 'confirmed',
        data: { linker: 'runtime.viewer' }
      }))
    }
  }

  const visibleNodes = elements.slice(0, maxNodes)
  const visibleIds = new Set(visibleNodes.map((element) => element.id))
  const visibleEdges = edges
    .filter((edge) => edge.source && edge.target && visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .slice(0, budget.edges ?? DEFAULT_OVERVIEW_BUDGET.edges)

  return {
    schemaVersion: 'context-graph-viewer-overview.v1',
    scopeId: options.scopeId ?? projectScope?.id,
    elements: {
      nodes: visibleNodes,
      edges: visibleEdges
    },
    stats: {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      visibleNodes: visibleNodes.length,
      visibleEdges: visibleEdges.length
    },
    budget,
    omitted: {
      nodes: Math.max(0, elements.length - visibleNodes.length),
      edges: Math.max(0, edges.length - visibleEdges.length),
      childScopes: 0,
      sourceRefs: 0,
      evidence: omittedEvidenceForViewerEdges(edges, budget.evidence ?? DEFAULT_OVERVIEW_BUDGET.evidence)
    },
    diagnostics: graph.diagnostics
  }
}

function packageNodeToViewerElement(node: ContextNode, graph: ContextGraph, scope: ContextGraphScope | undefined): GraphViewerElement {
  const scopeId = scope?.id ?? scopeIdForPackage(node.id)
  const sourceGroupIds = stringArrayProperty(node.properties.sourceGroupIds)
  const buildUnits = Array.isArray(node.properties.buildUnits) ? node.properties.buildUnits.length : 0
  return {
    id: node.id,
    kind: 'node',
    type: 'PackageGraph',
    label: node.name || node.id,
    scopeId,
    status: node.status,
    metrics: {
      nodes: scope?.stats.nodes ?? graph.nodes.filter((candidate) => candidate.id === node.id || sourceGroupIds.includes(candidate.id)).length,
      edges: scope?.stats.edges ?? graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length,
      files: scope?.stats.files ?? 0,
      groups: sourceGroupIds.length,
      diagnostics: scope?.stats.diagnostics ?? 0,
      adapters: scope?.adapterRefs.length ?? buildUnits
    },
    styleHints: styleForGraphType('PackageGraph'),
    rawRef: { factKind: 'node', factId: node.id, scopeId },
    data: {
      scope: scope ? scopeForViewer(scope) : undefined,
      packageKind: node.properties.packageKind,
      sourceGroupIds,
      buildUnits: node.properties.buildUnits,
      sourceRefs: node.sourceRefs.slice(0, DEFAULT_OVERVIEW_BUDGET.sourceRefs),
      properties: budgetProperties(node.properties)
    }
  }
}

async function readOptionalScopeManifest(outputDir: string): Promise<ContextGraphScopeManifest | undefined> {
  try {
    return JSON.parse(await readFile(join(outputDir, 'graph', 'scopes', 'manifest.json'), 'utf8')) as ContextGraphScopeManifest
  } catch {
    return undefined
  }
}

function scopeToViewerElement(scope: ContextGraphScope, graph: ContextGraph): GraphViewerElement {
  const rootNode = scope.rootNodeId ? graph.nodes.find((node) => node.id === scope.rootNodeId) : undefined
  return {
    id: scope.id,
    kind: 'node',
    type: graphTypeForScope(scope),
    label: scope.title || scope.id,
    scopeId: scope.id,
    status: scope.freshness.status,
    metrics: {
      nodes: scope.stats.nodes,
      edges: scope.stats.edges,
      files: scope.stats.files,
      groups: scope.stats.groups,
      diagnostics: scope.stats.diagnostics,
      adapters: scope.adapterRefs.length
    },
    styleHints: styleForGraphType(graphTypeForScope(scope)),
    rawRef: { factKind: 'scope', factId: scope.id, scopeId: scope.id },
    data: {
      scope: scopeForViewer(scope),
      rootNodeId: scope.rootNodeId,
      sourceGroupId: scope.sourceGroupId,
      path: scope.path,
      sourceRefs: rootNode?.sourceRefs.slice(0, DEFAULT_OVERVIEW_BUDGET.sourceRefs) ?? []
    }
  }
}

function viewerEdge(options: {
  id: string
  type: string
  source: string
  target: string
  label: string
  status?: string
  data?: Record<string, unknown>
}): GraphViewerElement {
  return {
    id: options.id,
    kind: 'edge',
    type: options.type,
    label: options.label,
    status: options.status,
    source: options.source,
    target: options.target,
    metrics: {},
    styleHints: styleForViewerEdgeType(options.type),
    rawRef: { factKind: 'edge', factId: options.id },
    data: options.data
  }
}

function scopeForViewer(scope: ContextGraphScope): Record<string, unknown> {
  return {
    id: scope.id,
    kind: scope.kind,
    parentScopeId: scope.parentScopeId,
    rootNodeId: scope.rootNodeId,
    sourceGroupId: scope.sourceGroupId,
    path: scope.path,
    title: scope.title,
    boundaryMode: scope.boundaryMode,
    adapterRefs: scope.adapterRefs,
    stats: scope.stats,
    freshness: scope.freshness
  }
}

function graphTypeForScope(scope: ContextGraphScope): string {
  switch (scope.kind) {
    case 'project':
      return 'ProjectGraph'
    case 'package':
      return 'PackageGraph'
    case 'source_group':
      return 'SourceGroupGraph'
    case 'file':
      return 'FileGraph'
    case 'content':
      return 'ContentGraph'
    default:
      return `${capitalize(scope.kind)}Graph`
  }
}

function packageNodeSort(left: ContextNode, right: ContextNode): number {
  return packageNodePriority(right) - packageNodePriority(left) || left.name.localeCompare(right.name)
}

function packageNodePriority(node: ContextNode): number {
  switch (node.properties.packageKind) {
    case 'code_repository':
      return 100
    case 'product_docs':
      return 95
    case 'analysis':
      return 90
    case 'design':
      return 85
    case 'data':
      return 80
    case 'runtime':
      return 75
    case 'asset':
      return 70
    default:
      return 50
  }
}

function scopeSort(left: ContextGraphScope, right: ContextGraphScope): number {
  return scopePriority(right) - scopePriority(left) || left.title.localeCompare(right.title)
}

function scopePriority(scope: ContextGraphScope): number {
  switch (scope.boundaryMode) {
    case 'repository':
      return 100
    case 'collapsed':
      return 90
    case 'expanded':
      return 80
    default:
      return scope.kind === 'project' ? 110 : 50
  }
}

export async function inspectGraphViewerTarget(options: GraphViewerInspectOptions): Promise<GraphViewerInspectResult> {
  const graph = await loadGraphFiles(options.outputDir)
  const node = graph.nodes.find((candidate) => candidate.id === options.targetId)
  const edge = graph.edges.find((candidate) => candidate.id === options.targetId)
  const diagnostics: Diagnostic[] = []
  const expansion = await safeRuntimeCall(
    () => expandGraphTarget({
      outputDir: options.outputDir,
      targetId: options.targetId,
      depth: options.depth,
      limitNodes: options.limitNodes,
      limitEdges: options.limitEdges,
      limitSourceRefs: options.limitSourceRefs,
      limitEvidence: options.limitEvidence
    }),
    diagnostics,
    'viewer.inspect.expand-failed'
  )
  const trace = await safeRuntimeCall(
    () => getLayeredSourceTrace({
      outputDir: options.outputDir,
      factId: options.targetId,
      limitNodes: options.limitNodes,
      limitEdges: options.limitEdges,
      limitSourceRefs: options.limitSourceRefs,
      limitEvidence: options.limitEvidence
    }),
    diagnostics,
    'viewer.inspect.trace-failed'
  )
  const explanation = await safeRuntimeCall(
    () => explainGraphFact({
      outputDir: options.outputDir,
      factId: options.targetId,
      limitSources: options.limitSourceRefs,
      limitEvidence: options.limitEvidence
    }),
    diagnostics,
    'viewer.inspect.explain-failed'
  )

  return {
    schemaVersion: 'context-graph-viewer-inspect.v1',
    targetId: options.targetId,
    targetKind: node ? 'node' : edge ? 'edge' : 'node',
    target: node ? nodeToViewerElement(node, graph, viewerBudget(options)) : edge ? edgeToViewerElement(edge, graph, viewerBudget(options)) : undefined,
    expansion,
    trace,
    explanation,
    diagnostics
  }
}

export async function searchGraphViewer(options: GraphViewerSearchOptions): Promise<GraphViewerSearchResult> {
  const graph = await loadGraphFiles(options.outputDir)
  const result = await searchContextIndex({
    outputDir: options.outputDir,
    graph,
    query: options.query,
    scopeId: options.scopeId,
    limit: options.limit
  })
  const budget = viewerBudget({})
  return {
    schemaVersion: 'context-graph-viewer-search.v1',
    engine: result.engine,
    indexPath: result.indexPath,
    scopeId: result.scopeId,
    results: result.results.map((node) => nodeToViewerElement(node, graph, budget)),
    diagnostics: result.diagnostics
  }
}

function viewerBudget(options: { limitNodes?: number; limitEdges?: number; limitSourceRefs?: number; limitEvidence?: number }): GraphDrillBudget {
  return {
    mode: 'summary',
    nodes: options.limitNodes ?? DEFAULT_OVERVIEW_BUDGET.nodes,
    edges: options.limitEdges ?? DEFAULT_OVERVIEW_BUDGET.edges,
    sourceRefs: options.limitSourceRefs ?? DEFAULT_OVERVIEW_BUDGET.sourceRefs,
    evidence: options.limitEvidence ?? DEFAULT_OVERVIEW_BUDGET.evidence
  }
}

function selectOverviewNodes(graph: ContextGraph, limit: number): ContextNode[] {
  return graph.nodes
    .filter((node) => !HIDDEN_OVERVIEW_NODE_TYPES.has(node.type))
    .sort(nodeSort)
    .slice(0, limit)
}

function nodeSort(left: ContextNode, right: ContextNode): number {
  return nodePriority(right) - nodePriority(left) || left.id.localeCompare(right.id)
}

function edgeSort(left: ContextEdge, right: ContextEdge): number {
  return edgePriority(right) - edgePriority(left) || left.id.localeCompare(right.id)
}

function nodePriority(node: ContextNode): number {
  switch (node.type) {
    case 'Project':
      return 100
    case 'SourceGroup':
      return 90
    case 'Requirement':
    case 'Document':
    case 'APIEndpoint':
      return 80
    case 'CodeSymbol':
      return 70
    case 'File':
      return 50
    default:
      return 40
  }
}

function edgePriority(edge: ContextEdge): number {
  switch (edge.type) {
    case 'contains_group':
      return 100
    case 'related_to_group':
      return 95
    case 'calls':
    case 'imports':
    case 'references':
      return 85
    case 'contains':
    case 'derived_from':
      return 70
    default:
      return 50
  }
}

function nodeToViewerElement(node: ContextNode, graph: ContextGraph, budget: GraphDrillBudget): GraphViewerElement {
  const sourceRefLimit = budget.sourceRefs ?? DEFAULT_OVERVIEW_BUDGET.sourceRefs
  const scopeId = viewerScopeIdForNode(node)
  return {
    id: node.id,
    kind: 'node',
    type: node.type,
    label: node.name || node.id,
    scopeId,
    status: node.status,
    metrics: {
      degree: graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id).length,
      sourceRefs: node.sourceRefs.length,
      requestCalls: Array.isArray(node.properties.requestCalls) ? node.properties.requestCalls.length : 0
    },
    styleHints: styleForNode(node),
    rawRef: { factKind: 'node', factId: node.id, scopeId },
    data: {
      name: node.name,
      sourceRefs: node.sourceRefs.slice(0, sourceRefLimit),
      properties: budgetProperties(node.properties)
    }
  }
}

function viewerScopeIdForNode(node: ContextNode): string | undefined {
  if (node.type === 'Package') {
    return scopeIdForPackage(node.id)
  }
  if (node.type === 'SourceGroup') {
    return scopeIdForSourceGroup(node.id)
  }
  return node.scopeId
}

function edgeToViewerElement(edge: ContextEdge, graph: ContextGraph, budget: GraphDrillBudget): GraphViewerElement {
  const evidenceLimit = budget.evidence ?? DEFAULT_OVERVIEW_BUDGET.evidence
  const source = graph.nodes.find((node) => node.id === edge.from)
  const target = graph.nodes.find((node) => node.id === edge.to)
  return {
    id: edge.id,
    kind: 'edge',
    type: edge.type,
    label: edge.type,
    scopeId: edge.scopeId,
    status: edge.status,
    source: edge.from,
    target: edge.to,
    metrics: {
      evidence: edge.evidence.length
    },
    styleHints: styleForEdge(edge),
    rawRef: { factKind: 'edge', factId: edge.id, scopeId: edge.scopeId },
    data: {
      fromLabel: source?.name ?? edge.from,
      toLabel: target?.name ?? edge.to,
      evidence: edge.evidence.slice(0, evidenceLimit),
      linker: edge.linker,
      properties: budgetProperties(edge.properties)
    }
  }
}

function styleForNode(node: ContextNode): GraphViewerElement['styleHints'] {
  switch (node.type) {
    case 'Project':
      return { color: '#2563eb', shape: 'round-rectangle', size: 56 }
    case 'Package':
      return { color: '#0f766e', shape: 'round-rectangle', size: 54 }
    case 'SourceGroup':
      return { color: '#0891b2', shape: 'round-rectangle', size: 48 }
    case 'Requirement':
      return { color: '#7c3aed', shape: 'ellipse', size: 42 }
    case 'Document':
    case 'Section':
      return { color: '#059669', shape: 'ellipse', size: 38 }
    case 'APIEndpoint':
      return { color: '#ea580c', shape: 'diamond', size: 42 }
    case 'CodeSymbol':
      return { color: '#0f766e', shape: 'hexagon', size: 36 }
    case 'File':
      return { color: '#64748b', shape: 'rectangle', size: 32 }
    default:
      return { color: '#475569', shape: 'ellipse', size: 30 }
  }
}

function styleForEdge(edge: ContextEdge): GraphViewerElement['styleHints'] {
  const dashed = edge.type === 'related_to_group' || edge.status === 'inferred'
  switch (edge.type) {
    case 'calls':
      return { color: '#dc2626', shape: 'triangle', size: 2, lineStyle: dashed ? 'dashed' : 'solid' }
    case 'imports':
    case 'references':
      return { color: '#2563eb', shape: 'triangle', size: 2, lineStyle: dashed ? 'dashed' : 'solid' }
    case 'related_to_group':
      return { color: '#9333ea', shape: 'triangle', size: 2, lineStyle: 'dashed' }
    default:
      return { color: '#64748b', shape: 'triangle', size: 1, lineStyle: dashed ? 'dashed' : 'solid' }
  }
}

function styleForGraphType(type: string): GraphViewerElement['styleHints'] {
  switch (type) {
    case 'ProjectGraph':
      return { color: '#1d4ed8', shape: 'round-rectangle', size: 68 }
    case 'PackageGraph':
      return { color: '#0f766e', shape: 'round-rectangle', size: 60 }
    case 'SourceGroupGraph':
      return { color: '#0e7490', shape: 'round-rectangle', size: 58 }
    case 'FileGraph':
    case 'FileGraphLayer':
      return { color: '#64748b', shape: 'rectangle', size: 46 }
    case 'ContentGraph':
    case 'ContentGraphLayer':
      return { color: '#059669', shape: 'ellipse', size: 44 }
    case 'FactGraph':
    case 'FactGraphLayer':
      return { color: '#7c3aed', shape: 'diamond', size: 46 }
    case 'RuntimeGraph':
    case 'RuntimeGraphLayer':
      return { color: '#ea580c', shape: 'hexagon', size: 44 }
    default:
      return { color: '#475569', shape: 'ellipse', size: 38 }
  }
}

function styleForViewerEdgeType(type: string): GraphViewerElement['styleHints'] {
  switch (type) {
    case 'has_child_scope':
      return { color: '#2563eb', shape: 'triangle', size: 2, lineStyle: 'solid' }
    case 'materializes_runtime':
      return { color: '#ea580c', shape: 'triangle', size: 2, lineStyle: 'dashed' }
    case 'related_to_group':
      return { color: '#9333ea', shape: 'triangle', size: 2, lineStyle: 'dashed' }
    default:
      return { color: '#64748b', shape: 'triangle', size: 1, lineStyle: 'solid' }
  }
}

function budgetProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const next = { ...properties }
  if (typeof next.content === 'string' && next.content.length > 320) {
    next.contentPreview = next.content.slice(0, 320)
    next.contentOmittedChars = next.content.length - 320
    delete next.content
  }
  return next
}

function stringArrayProperty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function omittedSourceRefs(nodes: ContextNode[], limit: number): number {
  return nodes.reduce((count, node) => count + Math.max(0, node.sourceRefs.length - limit), 0)
}

function omittedEvidence(edges: ContextEdge[], limit: number): number {
  return edges.reduce((count, edge) => count + Math.max(0, edge.evidence.length - limit), 0)
}

function omittedEvidenceForViewerEdges(edges: GraphViewerElement[], limit: number): number {
  return edges.reduce((count, edge) => {
    const evidence = edge.data?.evidence
    return count + (Array.isArray(evidence) ? Math.max(0, evidence.length - limit) : 0)
  }, 0)
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

async function safeRuntimeCall<T>(fn: () => Promise<T>, diagnostics: Diagnostic[], code: string): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    diagnostics.push(createDiagnostic({
      severity: 'warning',
      code,
      message: error instanceof Error ? error.message : String(error)
    }))
    return undefined
  }
}
