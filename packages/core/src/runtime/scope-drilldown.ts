import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  ContextEdge,
  ContextGraph,
  ContextGraphScope,
  ContextGraphScopeManifest,
  ContextNode,
  Evidence,
  GraphDrillBudget,
  GraphDrillMode,
  GraphDrillNextAction,
  GraphDrillOmitted,
  GraphExpansion,
  GraphExpansionDirection,
  GraphScopeView,
  LayeredSourceTrace
} from '../contracts/graph.js'
import type {
  SourceRef
} from '../contracts/config.js'
import { loadGraphFiles } from '../graph/index.js'

export interface GraphScopeViewOptions {
  outputDir: string
  scopeId: string
  mode?: GraphDrillMode
  limitNodes?: number
  limitEdges?: number
  limitChildScopes?: number
  limitSourceRefs?: number
  limitEvidence?: number
}

export interface GraphExpansionOptions {
  outputDir: string
  targetId: string
  mode?: GraphDrillMode
  direction?: GraphExpansionDirection
  depth?: number
  limitNodes?: number
  limitEdges?: number
  limitChildScopes?: number
  limitSourceRefs?: number
  limitEvidence?: number
}

export interface LayeredSourceTraceOptions {
  outputDir: string
  factId: string
  mode?: GraphDrillMode
  limitNodes?: number
  limitEdges?: number
  limitChildScopes?: number
  limitSources?: number
  limitSourceRefs?: number
  limitEvidence?: number
}

type ScopeManifestEntry = ContextGraphScopeManifest['scopes'][number]

const DEFAULT_SCOPE_BUDGET = {
  nodes: 30,
  edges: 40,
  childScopes: 20,
  sourceRefs: 10,
  evidence: 8
}

const DEFAULT_EXPANSION_BUDGET = {
  nodes: 40,
  edges: 60,
  childScopes: 20,
  sourceRefs: 10,
  evidence: 8,
  depth: 1
}

const ENTRYPOINT_TYPES = new Set(['SourceGroup', 'RepositoryGraph', 'SemanticCorpusGraph', 'ApiContractGraph', 'InventoryGraph', 'Requirement', 'CodeSymbol', 'APIEndpoint', 'Document', 'Section', 'File'])
const PROVENANCE_TYPES = new Set(['Source', 'SourceSnapshot'])

export async function getGraphScopeView(options: GraphScopeViewOptions): Promise<GraphScopeView> {
  const budget = scopeBudget(options)
  const [manifest, globalGraph] = await Promise.all([readScopeManifest(options.outputDir), loadGraphFiles(options.outputDir)])
  const scope = findScope(manifest, options.scopeId)
  const scopeGraph = await readScopeGraph(options.outputDir, scope)
  const childScopes = manifest.scopes.filter((candidate) => candidate.parentScopeId === scope.id).map(scopeWithoutFiles)
  const relatedScopes = relatedScopesForScope(scope, manifest, globalGraph)
  const nodes = selectScopeNodes(scopeGraph.nodes, scope, budget, scopeGraph.edges)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = selectEdges(scopeGraph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)), budget)
  const rootNode = nodes.find((node) => node.id === scope.rootNodeId) ?? globalGraph.nodes.find((node) => node.id === scope.rootNodeId)
  const entrypoints = nodes.filter((node) => ENTRYPOINT_TYPES.has(node.type)).slice(0, 12)
  const budgetedChildScopes = budget.mode === 'full' ? childScopes : childScopes.slice(0, budget.childScopes ?? DEFAULT_SCOPE_BUDGET.childScopes)
  const nextActions = nextActionsForScope(scopeWithoutFiles(scope), budgetedChildScopes, relatedScopes, entrypoints)

  return {
    schemaVersion: 'context-graph-scope-view.v1',
    scope: scopeWithoutFiles(scope),
    rootNode: rootNode ? budgetNode(rootNode, budget) : undefined,
    nodes: nodes.map((node) => budgetNode(node, budget)),
    edges: edges.map((edge) => budgetEdge(edge, budget)),
    childScopes: budgetedChildScopes,
    relatedScopes,
    entrypoints: entrypoints.map((node) => budgetNode(node, budget)),
    nextActions,
    budget,
    omitted: {
      nodes: Math.max(0, scopeGraph.nodes.length - nodes.length),
      edges: Math.max(0, scopeGraph.edges.length - edges.length),
      childScopes: Math.max(0, childScopes.length - budgetedChildScopes.length),
      sourceRefs: omittedSourceRefs(scopeGraph.nodes, nodes, budget),
      evidence: omittedEvidence(scopeGraph.edges, edges, budget)
    },
    diagnostics: scopeGraph.diagnostics
  }
}

export async function expandGraphTarget(options: GraphExpansionOptions): Promise<GraphExpansion> {
  const budget = expansionBudget(options)
  const [manifest, graph] = await Promise.all([readScopeManifest(options.outputDir), loadGraphFiles(options.outputDir)])
  const scopeTarget = manifest.scopes.find((scope) => scope.id === options.targetId)
  if (scopeTarget) {
    const view = await getGraphScopeView({
      outputDir: options.outputDir,
      scopeId: options.targetId,
      mode: options.mode,
      limitNodes: options.limitNodes,
      limitEdges: options.limitEdges,
      limitChildScopes: options.limitChildScopes,
      limitSourceRefs: options.limitSourceRefs,
      limitEvidence: options.limitEvidence
    })
    return {
      schemaVersion: 'context-graph-expansion.v1',
      target: { id: scopeTarget.id, kind: 'scope', scope: scopeWithoutFiles(scopeTarget) },
      targetKind: 'scope',
      scopePath: scopePath(manifest, scopeTarget.id),
      facts: view.nodes,
      edges: view.edges,
      nextActions: view.nextActions,
      budget,
      omitted: view.omitted,
      diagnostics: view.diagnostics
    }
  }

  const node = graph.nodes.find((candidate) => candidate.id === options.targetId)
  const edge = graph.edges.find((candidate) => candidate.id === options.targetId)
  if (!node && !edge) {
    throw new Error(`Graph expansion target not found: ${options.targetId}`)
  }

  const targetNode = node ?? (edge ? undefined : undefined)
  const containingScope = resolveContainingScope(manifest, targetNode, edge, graph)
  const depth = budget.depth ?? DEFAULT_EXPANSION_BUDGET.depth
  const relatedEdges = edge ? [edge] : collectNeighborhoodEdges(graph, options.targetId, depth, options.direction ?? 'around')
  const relatedNodeIds = new Set<string>()
  if (node) {
    relatedNodeIds.add(node.id)
  }
  for (const relatedEdge of relatedEdges) {
    relatedNodeIds.add(relatedEdge.from)
    relatedNodeIds.add(relatedEdge.to)
  }
  if (containingScope?.rootNodeId) {
    relatedNodeIds.add(containingScope.rootNodeId)
  }
  const facts = selectNodes(graph.nodes.filter((candidate) => relatedNodeIds.has(candidate.id)), containingScope, budget)
  const factIds = new Set(facts.map((fact) => fact.id))
  const edges = selectEdges(relatedEdges.filter((candidate) => factIds.has(candidate.from) && factIds.has(candidate.to)), budget)
  const sourceTrace = node
    ? await getLayeredSourceTrace({
      outputDir: options.outputDir,
      factId: node.id,
      mode: options.mode,
      limitNodes: options.limitNodes,
      limitSources: options.limitSourceRefs,
      limitEvidence: options.limitEvidence
    })
    : undefined
  const childScopes = containingScope ? manifest.scopes.filter((candidate) => candidate.parentScopeId === containingScope.id).map(scopeWithoutFiles) : []
  const sourceScopes = node
    ? uniqueScopes(node.sourceRefs
      .flatMap((sourceRef) => scopesForSourceRef(manifest, sourceRef))
      .filter((candidate) => candidate.kind === 'file' || candidate.kind === 'content')
      .filter((candidate) => candidate.id !== containingScope?.id))
      .map(scopeWithoutFiles)
    : []
  const relatedScopes = containingScope ? relatedScopesForScope(containingScope, manifest, graph) : []
  const childActionScopes = uniqueScopes([...sourceScopes, ...childScopes])
    .filter((scope) => scope.id !== containingScope?.id)
    .slice(0, budget.childScopes ?? DEFAULT_EXPANSION_BUDGET.childScopes)
  const nextActions = [
    ...(containingScope ? [openScopeAction(containingScope, 'Open the containing graph scope.')] : []),
    ...childActionScopes.map((scope) => openScopeAction(scope, sourceScopes.some((candidate) => candidate.id === scope.id) ? 'Open the source evidence graph scope.' : 'Open a child graph scope.')),
    ...relatedScopes.map((scope) => openScopeAction(scope, 'Follow a cross-scope weak relation.')),
    ...(node && node.sourceRefs.length > 0 ? [traceSourceAction(node.id)] : []),
    ...facts.filter((fact) => fact.id !== options.targetId).slice(0, 8).map((fact) => expandTargetAction(fact.id, `Expand related ${fact.type} ${fact.name}.`))
  ]

  return {
    schemaVersion: 'context-graph-expansion.v1',
    target: node
      ? { id: node.id, kind: 'node', node: budgetNode(node, budget) }
      : { id: edge?.id as string, kind: 'edge', edge: budgetEdge(edge as ContextEdge, budget) },
    targetKind: node ? 'node' : 'edge',
    scopePath: containingScope ? scopePath(manifest, containingScope.id) : [],
    facts: facts.map((fact) => budgetNode(fact, budget)),
    edges: edges.map((candidate) => budgetEdge(candidate, budget)),
    sourceTrace,
    nextActions: dedupeActions(nextActions),
    budget,
    omitted: {
      nodes: Math.max(0, relatedNodeIds.size - facts.length),
      edges: Math.max(0, relatedEdges.length - edges.length),
      childScopes: Math.max(0, childScopes.length - Math.min(childScopes.length, budget.childScopes ?? DEFAULT_EXPANSION_BUDGET.childScopes)),
      sourceRefs: omittedSourceRefs([...relatedNodeIds].flatMap((id) => graph.nodes.filter((candidate) => candidate.id === id)), facts, budget),
      evidence: omittedEvidence(relatedEdges, edges, budget)
    },
    diagnostics: []
  }
}

export async function getLayeredSourceTrace(options: LayeredSourceTraceOptions): Promise<LayeredSourceTrace> {
  const budget = traceBudget(options)
  const [manifest, graph] = await Promise.all([readScopeManifest(options.outputDir), loadGraphFiles(options.outputDir)])
  const node = graph.nodes.find((candidate) => candidate.id === options.factId)
  const edge = graph.edges.find((candidate) => candidate.id === options.factId)
  if (!node && !edge) {
    throw new Error(`Graph fact not found: ${options.factId}`)
  }
  const sourceRefs = uniqueSourceRefs([
    ...(node?.sourceRefs ?? []),
    ...sourceRefsForEvidence(edge?.evidence ?? []),
    ...sourceRefsForEvidence(node?.provenance.flatMap((entry) => entry.evidence) ?? []),
    ...sourceRefsForEvidence(edge?.provenance.flatMap((entry) => entry.evidence) ?? []),
    ...(node?.provenance.flatMap((entry) => entry.sourceRefs) ?? []),
    ...(edge?.provenance.flatMap((entry) => entry.sourceRefs) ?? [])
  ])
  const budgetedSources = budget.mode === 'full' ? sourceRefs : sourceRefs.slice(0, budget.sourceRefs ?? DEFAULT_SCOPE_BUDGET.sourceRefs)
  const visibleSourceRefs = budget.mode === 'full' ? sourceRefs : budgetedSources
  const sourceGroups = sourceGroupsForRefs(graph, visibleSourceRefs)
  const scopes = uniqueScopes([
    ...scopePathEntries(manifest, 'scope:project'),
    ...sourceGroups.flatMap((group) => {
      const scope = manifest.scopes.find((candidate) => candidate.sourceGroupId === group.id)
      return scope ? scopePathEntries(manifest, scope.id) : []
    }),
    ...visibleSourceRefs.flatMap((sourceRef) => scopesForSourceRef(manifest, sourceRef))
  ])
  const budgetedScopes = budget.mode === 'full' ? scopes : scopes.slice(0, budget.childScopes ?? DEFAULT_EXPANSION_BUDGET.childScopes)
  const scopedGraphs = await Promise.all(budgetedScopes.map((scope) => readScopeGraph(options.outputDir, scope).catch(() => ({ nodes: [], edges: [], diagnostics: [] } as ContextGraph))))
  const files = uniqueNodes(scopedGraphs.flatMap((scopedGraph) => scopedGraph.nodes.filter((candidate) => candidate.type === 'File')))
  const contentNodes = uniqueNodes(scopedGraphs.flatMap((scopedGraph) =>
    scopedGraph.nodes.filter((candidate) => !PROVENANCE_TYPES.has(candidate.type) && candidate.type !== 'File' && (candidate.id === options.factId || nodeHasAnySourceRef(candidate, sourceRefs)))
  ))
  if (node && !contentNodes.some((candidate) => candidate.id === node.id) && !PROVENANCE_TYPES.has(node.type) && node.type !== 'File') {
    contentNodes.unshift(node)
  }
  const evidence = [
    ...(edge?.evidence ?? []),
    ...(node?.provenance.flatMap((entry) => entry.evidence) ?? []),
    ...(edge?.provenance.flatMap((entry) => entry.evidence) ?? [])
  ]
  const budgetedEvidence = budget.mode === 'full' ? evidence : evidence.slice(0, budget.evidence ?? DEFAULT_SCOPE_BUDGET.evidence)
  const nodeLimit = budget.mode === 'full' ? Number.POSITIVE_INFINITY : budget.nodes ?? DEFAULT_EXPANSION_BUDGET.nodes
  const fileLimit = budget.mode === 'full' ? Number.POSITIVE_INFINITY : Math.min(files.length, Math.ceil(nodeLimit / 2))
  const contentLimit = budget.mode === 'full' ? Number.POSITIVE_INFINITY : Math.max(0, nodeLimit - Math.min(files.length, fileLimit))
  const budgetedFiles = selectNodesWithLimit(files, undefined, budget, fileLimit).map((candidate) => budgetNode(candidate, budget))
  const budgetedContentNodes = selectNodesWithLimit(contentNodes, undefined, budget, contentLimit).map((candidate) => budgetNode(candidate, budget))

  return {
    schemaVersion: 'context-layered-source-trace.v1',
    factId: options.factId,
    fact: node ? budgetNode(node, budget) : undefined,
    edge: edge ? budgetEdge(edge, budget) : undefined,
    sourceGroups: sourceGroups.map((group) => budgetNode(group, budget)),
    scopes: budgetedScopes.map(scopeWithoutFiles),
    files: budgetedFiles,
    contentNodes: budgetedContentNodes,
    sourceRefs: budgetedSources,
    evidence: budgetedEvidence.map((item) => budgetEvidence(item, budget)),
    budget,
    omitted: {
      nodes: Math.max(0, files.length + contentNodes.length - budgetedFiles.length - budgetedContentNodes.length),
      edges: 0,
      childScopes: Math.max(0, scopes.length - budgetedScopes.length),
      sourceRefs: Math.max(0, sourceRefs.length - budgetedSources.length),
      evidence: Math.max(0, evidence.length - budgetedEvidence.length)
    },
    diagnostics: []
  }
}

async function readScopeManifest(outputDir: string): Promise<ContextGraphScopeManifest> {
  return JSON.parse(await readFile(resolve(outputDir, 'graph', 'scopes', 'manifest.json'), 'utf8')) as ContextGraphScopeManifest
}

async function readScopeGraph(outputDir: string, scope: ScopeManifestEntry): Promise<ContextGraph> {
  const [nodes, edges] = await Promise.all([
    readJsonl<ContextNode>(resolveContextPath(outputDir, scope.nodes)),
    readJsonl<ContextEdge>(resolveContextPath(outputDir, scope.edges))
  ])
  return { nodes, edges, diagnostics: [] }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8')
  if (content.trim().length === 0) {
    return []
  }
  return content.trim().split('\n').map((line) => JSON.parse(line) as T)
}

function findScope(manifest: ContextGraphScopeManifest, scopeId: string): ScopeManifestEntry {
  const scope = manifest.scopes.find((candidate) => candidate.id === scopeId)
  if (!scope) {
    throw new Error(`Graph scope not found: ${scopeId}`)
  }
  return scope
}

function scopeWithoutFiles(scope: ScopeManifestEntry | ContextGraphScope): ContextGraphScope {
  const { nodes: _nodes, edges: _edges, summary: _summary, ...rest } = scope as ScopeManifestEntry
  return rest
}

function resolveContextPath(outputDir: string, path: string): string {
  if (path.startsWith('.context/')) {
    return resolve(outputDir, path.slice('.context/'.length))
  }
  return resolve(outputDir, path)
}

function scopeBudget(options: GraphScopeViewOptions): GraphDrillBudget {
  if (options.mode === 'full') {
    return { mode: 'full' }
  }
  return {
    mode: 'summary',
    nodes: options.limitNodes ?? DEFAULT_SCOPE_BUDGET.nodes,
    edges: options.limitEdges ?? DEFAULT_SCOPE_BUDGET.edges,
    childScopes: options.limitChildScopes ?? DEFAULT_SCOPE_BUDGET.childScopes,
    sourceRefs: options.limitSourceRefs ?? DEFAULT_SCOPE_BUDGET.sourceRefs,
    evidence: options.limitEvidence ?? DEFAULT_SCOPE_BUDGET.evidence
  }
}

function expansionBudget(options: GraphExpansionOptions): GraphDrillBudget {
  if (options.mode === 'full') {
    return { mode: 'full', depth: options.depth ?? DEFAULT_EXPANSION_BUDGET.depth }
  }
  return {
    mode: 'summary',
    nodes: options.limitNodes ?? DEFAULT_EXPANSION_BUDGET.nodes,
    edges: options.limitEdges ?? DEFAULT_EXPANSION_BUDGET.edges,
    childScopes: options.limitChildScopes ?? DEFAULT_EXPANSION_BUDGET.childScopes,
    sourceRefs: options.limitSourceRefs ?? DEFAULT_EXPANSION_BUDGET.sourceRefs,
    evidence: options.limitEvidence ?? DEFAULT_EXPANSION_BUDGET.evidence,
    depth: options.depth ?? DEFAULT_EXPANSION_BUDGET.depth
  }
}

function traceBudget(options: LayeredSourceTraceOptions): GraphDrillBudget {
  const sourceLimit = options.limitSourceRefs ?? options.limitSources
  if (options.mode === 'full') {
    return { mode: 'full' }
  }
  return {
    mode: 'summary',
    nodes: options.limitNodes ?? DEFAULT_EXPANSION_BUDGET.nodes,
    edges: options.limitEdges ?? DEFAULT_EXPANSION_BUDGET.edges,
    childScopes: options.limitChildScopes ?? DEFAULT_EXPANSION_BUDGET.childScopes,
    sourceRefs: sourceLimit ?? DEFAULT_EXPANSION_BUDGET.sourceRefs,
    evidence: options.limitEvidence ?? DEFAULT_EXPANSION_BUDGET.evidence
  }
}

function selectScopeNodes(nodes: ContextNode[], scope: ContextGraphScope, budget: GraphDrillBudget, edges: ContextEdge[]): ContextNode[] {
  const candidates = budget.mode === 'full' ? nodes : nodes.filter((node) => shouldShowNodeInScope(node, scope))
  return selectNodes(candidates, scope, budget, priorityNodeScoresForScope(nodes, edges))
}

function selectNodes(nodes: ContextNode[], scope: ContextGraphScope | undefined, budget: GraphDrillBudget, priorityNodeScores = new Map<string, number>()): ContextNode[] {
  const sorted = [...uniqueNodes(nodes)].sort((left, right) => nodeRank(left, scope, priorityNodeScores) - nodeRank(right, scope, priorityNodeScores) || left.id.localeCompare(right.id))
  return budget.mode === 'full' ? sorted : sorted.slice(0, budget.nodes ?? DEFAULT_SCOPE_BUDGET.nodes)
}

function selectNodesWithLimit(nodes: ContextNode[], scope: ContextGraphScope | undefined, budget: GraphDrillBudget, limit: number): ContextNode[] {
  const sorted = [...uniqueNodes(nodes)].sort((left, right) => nodeRank(left, scope, new Map()) - nodeRank(right, scope, new Map()) || left.id.localeCompare(right.id))
  return budget.mode === 'full' ? sorted : sorted.slice(0, Math.max(0, limit))
}

function selectEdges(edges: ContextEdge[], budget: GraphDrillBudget): ContextEdge[] {
  const sorted = [...uniqueEdges(edges)].sort((left, right) => edgeRank(left) - edgeRank(right) || left.id.localeCompare(right.id))
  return budget.mode === 'full' ? sorted : sorted.slice(0, budget.edges ?? DEFAULT_SCOPE_BUDGET.edges)
}

function shouldShowNodeInScope(node: ContextNode, scope: ContextGraphScope): boolean {
  if (node.id === scope.rootNodeId) return true
  if (scope.kind === 'project' || scope.kind === 'source_group') {
    return node.type !== 'SourceSnapshot' && node.type !== 'Source'
  }
  return true
}

function nodeRank(node: ContextNode, scope: ContextGraphScope | undefined, priorityNodeScores: Map<string, number>): number {
  if (scope?.rootNodeId === node.id) return -1000
  const priorityScore = priorityNodeScores.get(node.id) ?? 0
  if (priorityScore > 0) return -875 - Math.min(priorityScore, 100)
  switch (node.type) {
    case 'Project':
      return -950
    case 'SourceGroup':
      return -900
    case 'RepositoryGraph':
    case 'SemanticCorpusGraph':
    case 'ApiContractGraph':
    case 'InventoryGraph':
      return -880
    case 'Requirement':
      return -850
    case 'CodeSymbol':
      return -820
    case 'APIEndpoint':
      return -800
    case 'Document':
      return -760
    case 'Section':
      return -740
    case 'File':
      return -650
    case 'SourceSnapshot':
      return 900
    case 'Source':
      return 950
    default:
      return 0
  }
}

function priorityNodeScoresForScope(nodes: ContextNode[], edges: ContextEdge[]): Map<string, number> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const scores = new Map<string, number>()
  for (const edge of edges) {
    const target = nodeById.get(edge.to)
    const source = nodeById.get(edge.from)
    if (edge.type === 'derived_from' && target?.type === 'File' && source && !PROVENANCE_TYPES.has(source.type) && source.type !== 'File') {
      scores.set(target.id, (scores.get(target.id) ?? 0) + derivedSourceScore(source))
    }
  }
  return scores
}

function derivedSourceScore(node: ContextNode): number {
  switch (node.type) {
    case 'ExternalAPI':
      return 6
    case 'APIEndpoint':
      return 6
    case 'CodeSymbol': {
      const requestCalls = Array.isArray(node.properties.requestCalls) ? node.properties.requestCalls.length : 0
      return 3 + requestCalls * 4
    }
    case 'Requirement':
      return 5
    case 'Document':
    case 'Section':
      return 2
    default:
      return 1
  }
}

function edgeRank(edge: ContextEdge): number {
  switch (edge.type) {
    case 'related_to_group':
      return -900
    case 'has_child_scope':
      return -850
    case 'derived_from':
      return -700
    case 'contains_snapshot':
      return -500
    default:
      return 0
  }
}

function relatedScopesForScope(scope: ContextGraphScope, manifest: ContextGraphScopeManifest, graph: ContextGraph): ContextGraphScope[] {
  if (!scope.rootNodeId) {
    return []
  }
  const relatedGroupIds = graph.edges
    .filter((edge) => edge.type === 'related_to_group' && (edge.from === scope.rootNodeId || edge.to === scope.rootNodeId))
    .map((edge) => edge.from === scope.rootNodeId ? edge.to : edge.from)
  return uniqueScopes(relatedGroupIds
    .map((groupId) => manifest.scopes.find((candidate) => candidate.sourceGroupId === groupId))
    .filter((candidate): candidate is ScopeManifestEntry => Boolean(candidate)))
    .map(scopeWithoutFiles)
}

function nextActionsForScope(
  scope: ContextGraphScope,
  childScopes: ContextGraphScope[],
  relatedScopes: ContextGraphScope[],
  entrypoints: ContextNode[]
): GraphDrillNextAction[] {
  return dedupeActions([
    ...childScopes.map((childScope) => openScopeAction(childScope, 'Open a child graph scope.')),
    ...relatedScopes.map((relatedScope) => openScopeAction(relatedScope, 'Follow a cross-scope weak relation.')),
    ...entrypoints.filter((node) => node.id !== scope.rootNodeId).slice(0, 8).map((node) => expandTargetAction(node.id, `Expand ${node.type} ${node.name}.`))
  ])
}

function openScopeAction(scope: ContextGraphScope, reason: string): GraphDrillNextAction {
  return {
    type: 'open_scope',
    targetId: scope.id,
    label: scope.title,
    reason,
    scopeId: scope.id
  }
}

function expandTargetAction(targetId: string, reason: string): GraphDrillNextAction {
  return {
    type: 'expand_target',
    targetId,
    label: targetId,
    reason
  }
}

function traceSourceAction(targetId: string): GraphDrillNextAction {
  return {
    type: 'trace_source',
    targetId,
    label: `Trace ${targetId}`,
    reason: 'Trace this fact back through source group, file, content, and source references.'
  }
}

function collectNeighborhoodEdges(graph: ContextGraph, targetId: string, depth: number, direction: GraphExpansionDirection): ContextEdge[] {
  const seenNodes = new Set([targetId])
  const seenEdges = new Map<string, ContextEdge>()
  let frontier = new Set([targetId])
  for (let level = 0; level < Math.max(1, depth); level += 1) {
    const next = new Set<string>()
    for (const nodeId of frontier) {
      for (const edge of graph.edges) {
        const matches = direction === 'up'
          ? edge.to === nodeId
          : direction === 'down'
            ? edge.from === nodeId
            : edge.from === nodeId || edge.to === nodeId
        if (!matches) {
          continue
        }
        seenEdges.set(edge.id, edge)
        for (const endpoint of [edge.from, edge.to]) {
          if (!seenNodes.has(endpoint)) {
            seenNodes.add(endpoint)
            next.add(endpoint)
          }
        }
      }
    }
    frontier = next
  }
  return [...seenEdges.values()]
}

function resolveContainingScope(
  manifest: ContextGraphScopeManifest,
  node: ContextNode | undefined,
  edge: ContextEdge | undefined,
  graph: ContextGraph
): ScopeManifestEntry | undefined {
  if (node?.type === 'SourceGroup') {
    return manifest.scopes.find((scope) => scope.sourceGroupId === node.id)
  }
  const explicitScope = node?.scopeId ?? edge?.scopeId
  if (explicitScope) {
    const scope = manifest.scopes.find((candidate) => candidate.id === explicitScope)
    if (scope && scope.kind !== 'project') {
      return scope
    }
  }
  const refs = node?.sourceRefs ?? sourceRefsForEvidence(edge?.evidence ?? [])
  const sourceGroupScope = refs
    .flatMap((ref) => scopesForSourceRef(manifest, ref))
    .filter((scope) => scope.kind === 'build_graph' || scope.kind === 'source_group')
    .sort((left, right) => scopeContainmentRank(right) - scopeContainmentRank(left) || (right.path?.length ?? 0) - (left.path?.length ?? 0))[0]
  if (sourceGroupScope) {
    return sourceGroupScope
  }
  if (edge) {
    const fromScope = resolveContainingScope(manifest, graph.nodes.find((candidate) => candidate.id === edge.from), undefined, graph)
    if (fromScope) return fromScope
    return resolveContainingScope(manifest, graph.nodes.find((candidate) => candidate.id === edge.to), undefined, graph)
  }
  return manifest.scopes.find((scope) => scope.id === 'scope:project')
}

function scopesForSourceRef(manifest: ContextGraphScopeManifest, sourceRef: SourceRef): ScopeManifestEntry[] {
  const path = sourceRef.location?.path
  if (typeof path !== 'string') {
    return []
  }
  return manifest.scopes.filter((scope) =>
    (scope.kind === 'source_group' && typeof scope.path === 'string' && pathWithin(path, scope.path)) ||
    (scope.kind === 'build_graph' && typeof scope.path === 'string' && pathWithin(path, scope.path)) ||
    (scope.kind === 'file' && scope.path === path) ||
    (scope.kind === 'content' && scope.path === `${path}#content`)
  )
}

function scopeContainmentRank(scope: ScopeManifestEntry): number {
  if (scope.kind === 'build_graph') return 2
  if (scope.kind === 'source_group') return 1
  return 0
}

function scopePath(manifest: ContextGraphScopeManifest, scopeId: string): ContextGraphScope[] {
  return scopePathEntries(manifest, scopeId).map(scopeWithoutFiles)
}

function scopePathEntries(manifest: ContextGraphScopeManifest, scopeId: string): ScopeManifestEntry[] {
  const path: ScopeManifestEntry[] = []
  let current = manifest.scopes.find((scope) => scope.id === scopeId)
  while (current) {
    path.unshift(current)
    current = current.parentScopeId ? manifest.scopes.find((scope) => scope.id === current?.parentScopeId) : undefined
  }
  return path as ScopeManifestEntry[]
}

function sourceGroupsForRefs(graph: ContextGraph, sourceRefs: SourceRef[]): ContextNode[] {
  return graph.nodes
    .filter((node) => node.type === 'SourceGroup' && typeof node.properties.path === 'string')
    .filter((group) => sourceRefs.some((sourceRef) => {
      const path = sourceRef.location?.path
      return typeof path === 'string' && pathWithin(path, group.properties.path as string)
    }))
    .sort((left, right) => String(left.properties.path).length - String(right.properties.path).length || left.id.localeCompare(right.id))
}

function nodeHasAnySourceRef(node: ContextNode, sourceRefs: SourceRef[]): boolean {
  return node.sourceRefs.some((left) => sourceRefs.some((right) => sameSourceRef(left, right)))
}

function budgetNode(node: ContextNode, budget: GraphDrillBudget): ContextNode {
  if (budget.mode === 'full') {
    return node
  }
  const sourceLimit = budget.sourceRefs ?? DEFAULT_SCOPE_BUDGET.sourceRefs
  const properties = { ...node.properties }
  const content = properties.content
  if (typeof content === 'string' && content.length > 240) {
    properties.contentPreview = content.slice(0, 240)
    properties.contentOmittedChars = content.length - 240
    delete properties.content
  }
  return {
    ...node,
    sourceRefs: node.sourceRefs.slice(0, sourceLimit),
    provenance: [],
    properties
  }
}

function budgetEdge(edge: ContextEdge, budget: GraphDrillBudget): ContextEdge {
  if (budget.mode === 'full') {
    return edge
  }
  const evidenceLimit = budget.evidence ?? DEFAULT_SCOPE_BUDGET.evidence
  return {
    ...edge,
    evidence: edge.evidence.slice(0, evidenceLimit).map((item) => budgetEvidence(item, budget)),
    provenance: []
  }
}

function budgetEvidence(evidence: Evidence, budget: GraphDrillBudget): Evidence {
  if (budget.mode === 'full') {
    return evidence
  }
  return {
    ...evidence,
    sourceRefs: evidence.sourceRefs.slice(0, budget.sourceRefs ?? DEFAULT_SCOPE_BUDGET.sourceRefs)
  }
}

function omittedSourceRefs(original: ContextNode[], selected: ContextNode[], budget: GraphDrillBudget): number {
  if (budget.mode === 'full') {
    return 0
  }
  const sourceLimit = budget.sourceRefs ?? DEFAULT_SCOPE_BUDGET.sourceRefs
  const originalRefs = original.reduce((count, node) => count + node.sourceRefs.length, 0)
  const selectedRefs = selected.reduce((count, node) => count + Math.min(node.sourceRefs.length, sourceLimit), 0)
  return Math.max(0, originalRefs - selectedRefs)
}

function omittedEvidence(original: ContextEdge[], selected: ContextEdge[], budget: GraphDrillBudget): number {
  if (budget.mode === 'full') {
    return 0
  }
  const evidenceLimit = budget.evidence ?? DEFAULT_SCOPE_BUDGET.evidence
  const originalEvidence = original.reduce((count, edge) => count + edge.evidence.length, 0)
  const selectedEvidence = selected.reduce((count, edge) => count + Math.min(edge.evidence.length, evidenceLimit), 0)
  return Math.max(0, originalEvidence - selectedEvidence)
}

function sourceRefsForEvidence(evidence: Evidence[]): SourceRef[] {
  return evidence.flatMap((item) => item.sourceRefs)
}

function uniqueSourceRefs(sourceRefs: SourceRef[]): SourceRef[] {
  const refs = new Map<string, SourceRef>()
  for (const ref of sourceRefs) {
    refs.set(`${ref.sourceId}:${ref.uri}:${ref.location?.path ?? ''}:${ref.location?.lineStart ?? ''}:${ref.location?.lineEnd ?? ''}`, ref)
  }
  return [...refs.values()]
}

function uniqueNodes(nodes: ContextNode[]): ContextNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
}

function uniqueEdges(edges: ContextEdge[]): ContextEdge[] {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()]
}

function uniqueScopes(scopes: Array<ContextGraphScope | ScopeManifestEntry>): ScopeManifestEntry[] {
  return [...new Map(scopes.map((scope) => [scope.id, scope as ScopeManifestEntry])).values()]
}

function dedupeActions(actions: GraphDrillNextAction[]): GraphDrillNextAction[] {
  return [...new Map(actions.map((action) => [`${action.type}:${action.targetId}`, action])).values()]
}

function sameSourceRef(left: SourceRef, right: SourceRef): boolean {
  return left.sourceId === right.sourceId && left.uri === right.uri && left.location?.path === right.location?.path
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}
