import type {
  ContextEdge,
  ContextGraph,
  ContextGraphAdapterRef,
  ContextGraphScope,
  ContextGraphScopeKind,
  ContextNode,
  Evidence
} from '../contracts/graph.js'
import type {
  ContextPackageBuildUnit,
  ContextPackageKind,
  ContextPackageRecord,
  ContextSourceGroupKind,
  ContextSourceGroupRecord,
  ContextSourceInventory,
  ContextSourceInventoryEntry
} from '../contracts/sources.js'
import type { GraphAdapterManifest } from '../contracts/adapters.js'
import { createContextEdge, createContextNode, evidenceFromSource, slug } from './model.js'

const CODE_GRAPH_ADAPTER_ID = 'codegraph.graph-adapter'

export interface ContextScopedGraph {
  scope: ContextGraphScope
  graph: ContextGraph
}

export interface BuildGraphScopesResult {
  scopes: ContextGraphScope[]
  graphs: ContextScopedGraph[]
  adapters: GraphAdapterManifest[]
}

interface BuildGraphScopeContext {
  scope: ContextGraphScope
  group: ContextSourceGroupRecord
  packageRecord?: ContextPackageRecord
  buildUnit: ContextPackageBuildUnit
  rootNode: ContextNode
}

/** Build recursive Graph-of-Graphs projections from the canonical project graph. */
export function buildGraphScopes(graph: ContextGraph, sourceInventory?: ContextSourceInventory): BuildGraphScopesResult {
  const generatedAt = new Date().toISOString()
  const groups = sourceGroupsFrom(graph, sourceInventory)
  const packages = packagesFrom(graph, sourceInventory, groups)
  const packageScopes = packages.map((record) => packageScope(graph, sourceInventory, record, groups, generatedAt))
  const groupScopes = groups.map((group) => sourceGroupScope(graph, sourceInventory, group, groups, packages, generatedAt))
  const buildGraphScopeContexts = buildGraphScopesForSourceGroups(groups, packages, generatedAt)
  const projectScope = finalizeScope(
    {
      id: 'scope:project',
      kind: 'project',
      title: 'Project Graph',
      rootNodeId: graph.nodes.find((node) => node.type === 'Project')?.id,
      summary: 'Canonical typed project graph.',
      adapterRefs: [{ adapterId: 'builtin.source-inventory', role: 'inventory' }],
      freshness: { status: 'fresh', checkedAt: generatedAt },
      indexRefs: indexRefsForScope('scope:project')
    },
    graph,
    sourceInventory,
    groups
  )

  const packageGraphs = packageScopes.map((scope) => packageGraph(scope, graph, sourceInventory, groups, packages))
  const groupGraphs = groupScopes.map((scope) => sourceGroupGraph(scope, graph, sourceInventory, groups, buildGraphScopeContexts))
  const buildGraphs = buildGraphScopeContexts.map((context) => buildGraphScopeGraph(context, graph, sourceInventory, groups))
  const fileGraphs = sourceInventory ? buildFileScopes(graph, sourceInventory, groupScopes, buildGraphScopeContexts, generatedAt) : []
  const contentGraphs = sourceInventory ? buildContentScopes(graph, sourceInventory, groupScopes, generatedAt) : []
  const projectGraph: ContextScopedGraph = {
    scope: withStats(projectScope, graph, sourceInventory, groups),
    graph: withGraphScope(graph, projectScope.id)
  }
  const allGraphs = [projectGraph, ...packageGraphs, ...groupGraphs, ...buildGraphs, ...fileGraphs, ...contentGraphs]
  return {
    scopes: allGraphs.map((entry) => entry.scope),
    graphs: allGraphs,
    adapters: BUILTIN_GRAPH_ADAPTERS
  }
}

function packagesFrom(graph: ContextGraph, sourceInventory: ContextSourceInventory | undefined, groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  if (sourceInventory?.packages && sourceInventory.packages.length > 0) {
    return sourceInventory.packages
  }
  const packageNodes = graph.nodes.filter((node) => node.type === 'Package')
  if (packageNodes.length > 0) {
    return packageNodes.map((node) => packageRecordFromNode(node, groups))
  }
  return []
}

function packageRecordFromNode(node: ContextNode, groups: ContextSourceGroupRecord[]): ContextPackageRecord {
  const sourceGroupIds = stringArrayProperty(node, 'sourceGroupIds')
  const path = stringProperty(node, 'path') ?? node.sourceRefs[0]?.location?.path ?? node.name
  const kind = packageKind(stringProperty(node, 'packageKind'))
  return {
    id: node.id,
    sourceName: stringProperty(node, 'sourceName') ?? node.sourceRefs[0]?.sourceId ?? 'source',
    path,
    title: node.name,
    kind,
    summary: stringProperty(node, 'summary') ?? node.name,
    sourceGroupIds: sourceGroupIds.length > 0 ? sourceGroupIds : groups.filter((group) => pathWithin(group.path, path)).map((group) => group.id),
    buildUnits: [],
    confidence: node.confidence,
    decisionSource: 'inferred',
    sourceRef: node.sourceRefs[0] ?? { sourceId: 'source', uri: `file://${path}`, location: { path } }
  }
}

function sourceGroupsFrom(graph: ContextGraph, sourceInventory: ContextSourceInventory | undefined): ContextSourceGroupRecord[] {
  if (sourceInventory?.groups && sourceInventory.groups.length > 0) {
    return sourceInventory.groups
  }
  return graph.nodes
    .filter((node) => node.type === 'SourceGroup')
    .map((node) => {
      const path = stringProperty(node, 'path') ?? node.sourceRefs[0]?.location?.path ?? node.name
      const kind = sourceGroupKind(stringProperty(node, 'kind'))
      return {
        id: node.id,
        sourceName: stringProperty(node, 'sourceName') ?? node.sourceRefs[0]?.sourceId ?? 'source',
        path,
        title: node.name,
        kind,
        boundaryMode: boundaryMode(node) ?? 'collapsed',
        summary: stringProperty(node, 'summary') ?? node.name,
        childrenPolicy: stringProperty(node, 'childrenPolicy'),
        confidence: node.confidence,
        decisionSource: 'inferred',
        sourceRef: node.sourceRefs[0] ?? { sourceId: 'source', uri: `file://${path}`, location: { path } }
      }
    })
}

function packageScope(
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  record: ContextPackageRecord,
  groups: ContextSourceGroupRecord[],
  generatedAt: string
): ContextGraphScope {
  const scopeId = scopeIdForPackage(record.id)
  const packageGraph = graphForPackageScope(scopeId, graph, sourceInventory, record, groups)
  return finalizeScope(
    {
      id: scopeId,
      kind: 'package',
      parentScopeId: 'scope:project',
      rootNodeId: record.id,
      packageId: record.id,
      path: record.path,
      title: record.title,
      summary: record.summary,
      boundaryMode: 'collapsed',
      adapterRefs: adapterRefsForPackage(record),
      freshness: { status: 'fresh', checkedAt: generatedAt },
      indexRefs: indexRefsForScope(scopeId)
    },
    packageGraph,
    sourceInventory,
    groups
  )
}

function sourceGroupScope(
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  group: ContextSourceGroupRecord,
  groups: ContextSourceGroupRecord[],
  packages: ContextPackageRecord[],
  generatedAt: string
): ContextGraphScope {
  const parent = parentGroupFor(group, groups)
  const parentPackage = packageForGroup(group, packages)
  const scopeId = scopeIdForSourceGroup(group.id)
  const nodeCount = graph.nodes.filter((node) => nodeWithinGroup(node, group.path)).length
  const fileCount = sourceInventory?.entries.filter((entry) => pathWithin(entry.path, group.path)).length ?? 0
  return finalizeScope(
    {
      id: scopeId,
      kind: 'source_group',
      parentScopeId: parent ? scopeIdForSourceGroup(parent.id) : parentPackage ? scopeIdForPackage(parentPackage.id) : 'scope:project',
      rootNodeId: group.id,
      packageId: parentPackage?.id,
      sourceGroupId: group.id,
      path: group.path,
      title: group.title,
      summary: group.summary,
      boundaryMode: group.boundaryMode,
      adapterRefs: adapterRefsForSourceGroupKind(group.kind),
      freshness: { status: 'fresh', checkedAt: generatedAt },
      indexRefs: indexRefsForScope(scopeId)
    },
    { nodes: graph.nodes.slice(0, nodeCount), edges: [], diagnostics: [] },
    sourceInventory,
    groups,
    fileCount
  )
}

function buildGraphScopesForSourceGroups(
  groups: ContextSourceGroupRecord[],
  packages: ContextPackageRecord[],
  generatedAt: string
): BuildGraphScopeContext[] {
  return groups.flatMap((group) => buildUnitContextsForGroup(group, packages).map(({ packageRecord, buildUnit }) => {
    const scopeId = scopeIdForBuildGraph(group.id, buildUnit.id, buildUnit.standardKind)
    const rootNode = buildGraphNode(group, packageRecord, buildUnit, scopeId)
    return {
      scope: {
        id: scopeId,
        kind: 'build_graph',
        parentScopeId: scopeIdForSourceGroup(group.id),
        rootNodeId: rootNode.id,
        packageId: packageRecord?.id,
        sourceGroupId: group.id,
        path: buildUnit.path ?? group.path,
        title: buildGraphTitle(buildUnit.standardKind, group.title),
        summary: buildUnit.summary ?? buildGraphSummary(buildUnit.standardKind, group.title),
        boundaryMode: group.boundaryMode,
        adapterRefs: dedupeAdapterRefs([buildUnit.adapterSelection, selectedAdapter(buildUnit.adapterId, roleForStandardKind(buildUnit.standardKind), `Build ${buildUnit.standardKind} graph for ${group.title}.`)]),
        freshness: { status: 'fresh', checkedAt: generatedAt },
        indexRefs: indexRefsForScope(scopeId),
        stats: emptyStats()
      },
      group,
      packageRecord,
      buildUnit,
      rootNode
    }
  }))
}

function buildUnitContextsForGroup(
  group: ContextSourceGroupRecord,
  packages: ContextPackageRecord[]
): Array<{ packageRecord?: ContextPackageRecord; buildUnit: ContextPackageBuildUnit }> {
  const matches = packages.flatMap((record) =>
    record.buildUnits
      .filter((unit) => unit.sourceGroupIds.includes(group.id))
      .map((buildUnit) => ({ packageRecord: record, buildUnit }))
  )
  if (matches.length > 0) {
    return matches
  }
  return [{ buildUnit: fallbackBuildUnitForGroup(group) }]
}

function fallbackBuildUnitForGroup(group: ContextSourceGroupRecord): ContextPackageBuildUnit {
  const standardKind = standardKindForSourceGroupKind(group.kind)
  const adapterSelection = adapterRefsForSourceGroupKind(group.kind).find((ref) => ref.role !== 'inventory') ?? inventoryAdapter(`Default inventory-only adapter for ${group.kind} source groups.`)
  return {
    id: `unit:${slug(`${group.sourceName}:${group.path}:${standardKind}`)}`,
    kind: buildUnitKindForStandardKind(standardKind),
    standardKind,
    title: group.title,
    sourceGroupIds: [group.id],
    adapterId: adapterSelection.adapterId,
    adapterSelection,
    path: group.path,
    summary: group.summary
  }
}

function buildGraphNode(
  group: ContextSourceGroupRecord,
  packageRecord: ContextPackageRecord | undefined,
  buildUnit: ContextPackageBuildUnit,
  scopeId: string
): ContextNode {
  return createContextNode({
    id: buildGraphNodeId(group.id, buildUnit),
    type: nodeTypeForStandardKind(buildUnit.standardKind),
    name: buildGraphTitle(buildUnit.standardKind, buildUnit.title || group.title),
    scopeId,
    parentScopeId: scopeIdForSourceGroup(group.id),
    subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`,
    sourceRefs: [group.sourceRef],
    properties: {
      level: 'L2',
      packageId: packageRecord?.id,
      sourceGroupId: group.id,
      sourceGroupKind: group.kind,
      buildUnitId: buildUnit.id,
      buildUnitKind: buildUnit.kind,
      standardKind: buildUnit.standardKind,
      adapterId: buildUnit.adapterId,
      adapterSelection: buildUnit.adapterSelection,
      path: buildUnit.path ?? group.path,
      summary: buildUnit.summary ?? group.summary,
      normalizesThirdPartyOutput: true
    }
  })
}

function packageGraph(
  scope: ContextGraphScope,
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  groups: ContextSourceGroupRecord[],
  packages: ContextPackageRecord[]
): ContextScopedGraph {
  const record = packages.find((candidate) => candidate.id === scope.packageId)
  const scopedGraph = record ? graphForPackageScope(scope.id, graph, sourceInventory, record, groups) : { nodes: [], edges: [], diagnostics: [] }
  return {
    scope: withStats(scope, scopedGraph, sourceInventory, groups),
    graph: scopedGraph
  }
}

function graphForPackageScope(
  scopeId: string,
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  record: ContextPackageRecord,
  groups: ContextSourceGroupRecord[]
): ContextGraph {
  const selectedNodes = new Map<string, ContextNode>()
  const packageNode = graph.nodes.find((node) => node.id === record.id)
  if (packageNode) {
    selectedNodes.set(packageNode.id, withNodeScope(packageNode, { id: scopeId, parentScopeId: 'scope:project' }))
  }
  const groupIds = new Set(record.sourceGroupIds)
  for (const node of graph.nodes) {
    if (node.type === 'SourceGroup' && groupIds.has(node.id)) {
      selectedNodes.set(node.id, withNodeScope(node, { id: scopeId, parentScopeId: record.id }))
    }
  }
  const nodeIds = new Set(selectedNodes.keys())
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .filter((edge) => edge.type === 'contains_source_group' || edge.type === 'has_child_scope' || edge.type === 'materializes_subgraph')
    .map((edge) => withEdgeScope(edge, scopeId))

  for (const groupId of groupIds) {
    if (!nodeIds.has(groupId) || !packageNode) continue
    edges.push(
      createContextEdge({
        id: `EDGE-${record.id}-has-child-scope-${groupId}`,
        from: record.id,
        to: groupId,
        type: 'has_child_scope',
        linker: 'graph.scope-builder',
        status: 'confirmed',
        scopeId,
        evidence: [],
        properties: {
          childScopeId: scopeIdForSourceGroup(groupId),
          childScopeKind: 'source_group'
        }
      })
    )
  }

  return {
    nodes: [...selectedNodes.values()].sort(byId),
    edges: dedupeEdges(edges).sort(byId),
    diagnostics: graph.diagnostics.filter((diagnostic) => diagnostic.relatedNodes.some((nodeId) => nodeIds.has(nodeId)))
  }
}

function sourceGroupGraph(
  scope: ContextGraphScope,
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  groups: ContextSourceGroupRecord[],
  buildGraphScopeContexts: BuildGraphScopeContext[]
): ContextScopedGraph {
  const groupPath = scope.path
  const selectedNodes = new Map<string, ContextNode>()
  if (!groupPath) {
    return { scope, graph: { nodes: [], edges: [], diagnostics: [] } }
  }

  for (const node of graph.nodes) {
    if (
      node.id === scope.rootNodeId ||
      directChildGroupWithin(node, scope.sourceGroupId, groupPath, groups)
    ) {
      selectedNodes.set(node.id, withNodeScope(node, scope))
    }
  }

  for (const context of buildGraphScopeContexts.filter((candidate) => candidate.scope.sourceGroupId === scope.sourceGroupId)) {
    const node = withNodeScope(context.rootNode, scope)
    selectedNodes.set(node.id, node)
  }

  const nodeIds = new Set(selectedNodes.keys())
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
      .map((edge) => withEdgeScope(edge, scope.id))

  edges.push(...buildGraphChildScopeEdges(scope, buildGraphScopeContexts.filter((candidate) => candidate.scope.sourceGroupId === scope.sourceGroupId)))
  edges.push(...childScopeEdges(scope, groups))

  const scopedGraph = {
    nodes: [...selectedNodes.values()].sort(byId),
    edges: dedupeEdges(edges).sort(byId),
    diagnostics: graph.diagnostics.filter((diagnostic) => diagnostic.relatedNodes.some((nodeId) => nodeIds.has(nodeId)))
  }
  return {
    scope: withStats(scope, scopedGraph, sourceInventory, groups),
    graph: scopedGraph
  }
}

function buildGraphScopeGraph(
  context: BuildGraphScopeContext,
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  groups: ContextSourceGroupRecord[]
): ContextScopedGraph {
  const groupPath = context.group.path
  const selectedNodes = new Map<string, ContextNode>([[context.rootNode.id, context.rootNode]])
  const fileNodes = new Map<string, ContextNode>()

  for (const node of graph.nodes) {
    if (directNodeWithinGroup(node, context.group.id, groupPath, groups)) {
      selectedNodes.set(node.id, withNodeScope(node, context.scope))
    }
  }

  for (const entry of directEntriesWithinGroup(sourceInventory, context.group.id, groupPath, groups)) {
    fileNodes.set(entry.path, sourceFileNode(entry, context.scope, fileScopeIdForEntry(entry)))
  }
  for (const node of fileNodes.values()) {
    selectedNodes.set(node.id, node)
  }

  const nodeIds = new Set(selectedNodes.keys())
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => withEdgeScope(edge, context.scope.id))

  edges.push(...fileChildScopeEdges(context.scope, fileNodes))
  edges.push(...buildGraphContainsEdges(context, selectedNodes))
  edges.push(...derivedFromEdges(context.scope, selectedNodes, fileNodes))

  const scopedGraph = {
    nodes: [...selectedNodes.values()].sort(byId),
    edges: dedupeEdges(edges).sort(byId),
    diagnostics: graph.diagnostics.filter((diagnostic) => diagnostic.relatedNodes.some((nodeId) => nodeIds.has(nodeId)))
  }

  return {
    scope: withStats(context.scope, scopedGraph, sourceInventory, groups),
    graph: scopedGraph
  }
}

function buildFileScopes(
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory,
  groupScopes: ContextGraphScope[],
  buildGraphScopeContexts: BuildGraphScopeContext[],
  generatedAt: string
): ContextScopedGraph[] {
  return sourceInventory.entries
    .filter((entry) => entry.status !== 'skipped')
    .map((entry) => {
      const scopeId = fileScopeIdForEntry(entry)
      const groupScope = groupScopes
        .filter((scope) => scope.path && pathWithin(entry.path, scope.path))
        .sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))[0]
      const parentScope = buildGraphScopeForEntry(entry, groupScope, buildGraphScopeContexts) ?? groupScope
      const file = sourceFileNode(entry, { id: scopeId, parentScopeId: parentScope?.id } as ContextGraphScope, scopeId)
      const snapshot = sourceSnapshotNode(entry, { id: scopeId, parentScopeId: file.id })
      const derivedNodes = graph.nodes
        .filter((node) => node.sourceRefs.some((sourceRef) => sourceRef.location?.path === entry.path))
        .map((node) => withNodeScope(node, { id: scopeId, parentScopeId: file.id } as ContextGraphScope))
      const nodes = [
        file,
        snapshot,
        ...derivedNodes
      ]
      const nodeIds = new Set(nodes.map((node) => node.id))
      const snapshotNodes = new Map([[entry.path, snapshot]])
      const contentScopeId = derivedNodes.length > 0 ? contentScopeIdForEntry(entry) : undefined
      const edges = [
        ...graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)).map((edge) => withEdgeScope(edge, scopeId)),
        ...containsSnapshotEdges({ id: scopeId, rootNodeId: file.id } as ContextGraphScope, snapshotNodes),
        ...derivedFromEdges({ id: scopeId } as ContextGraphScope, new Map(nodes.map((node) => [node.id, node])), snapshotNodes),
        ...(contentScopeId ? [contentChildScopeEdge(scopeId, file, derivedNodes[0] ?? snapshot, contentScopeId, entry.path)] : [])
      ]
      const scope = finalizeScope(
        {
          id: scopeId,
          kind: 'file',
          parentScopeId: parentScope?.id ?? 'scope:project',
          rootNodeId: file.id,
          sourceGroupId: groupScope?.sourceGroupId,
          path: entry.path,
          title: entry.path,
          summary: `File graph for ${entry.path}`,
          adapterRefs: adapterRefsForRoute(entry.route),
          freshness: { status: 'fresh', checkedAt: generatedAt },
          indexRefs: indexRefsForScope(scopeId)
        },
        { nodes, edges, diagnostics: [] },
        sourceInventory,
        []
      )
      return { scope, graph: { nodes: dedupeNodes(nodes).sort(byId), edges: dedupeEdges(edges).sort(byId), diagnostics: [] } }
    })
}

function buildContentScopes(
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory,
  groupScopes: ContextGraphScope[],
  generatedAt: string
): ContextScopedGraph[] {
  return sourceInventory.entries
    .filter((entry) => entry.status === 'routed')
    .map((entry) => {
      const derivedNodes = graph.nodes.filter(
        (node) => node.type !== 'Source' && node.type !== 'SourceGroup' && node.type !== 'SourceSnapshot' && node.sourceRefs.some((sourceRef) => sourceRef.location?.path === entry.path)
      )
      if (derivedNodes.length === 0) {
        return undefined
      }
      const fileScopeId = fileScopeIdForEntry(entry)
      const scopeId = contentScopeIdForEntry(entry)
      const groupScope = groupScopes
        .filter((scope) => scope.path && pathWithin(entry.path, scope.path))
        .sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))[0]
      const file = sourceFileNode(entry, { id: scopeId, parentScopeId: fileScopeId } as ContextGraphScope, fileScopeId)
      const snapshot = sourceSnapshotNode(entry, { id: scopeId, parentScopeId: file.id })
      const scopedNodes = [file, snapshot, ...derivedNodes.map((node) => withNodeScope(node, { id: scopeId, parentScopeId: file.id }))]
      const nodeIds = new Set(scopedNodes.map((node) => node.id))
      const edges = [
        ...graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)).map((edge) => withEdgeScope(edge, scopeId)),
        ...containsSnapshotEdges({ id: scopeId, rootNodeId: file.id } as ContextGraphScope, new Map([[entry.path, snapshot]])),
        ...derivedFromEdges({ id: scopeId } as ContextGraphScope, new Map(scopedNodes.map((node) => [node.id, node])), new Map([[entry.path, snapshot]]))
      ]
      const scopedGraph: ContextGraph = { nodes: dedupeNodes(scopedNodes).sort(byId), edges: dedupeEdges(edges).sort(byId), diagnostics: [] }
      const scope = finalizeScope(
        {
          id: scopeId,
          kind: 'content',
          parentScopeId: fileScopeId,
          rootNodeId: derivedNodes[0]?.id ?? snapshot.id,
          sourceGroupId: groupScope?.sourceGroupId,
          path: `${entry.path}#content`,
          title: `${entry.path} content`,
          summary: `Content graph for ${entry.path}`,
          adapterRefs: adapterRefsForRoute(entry.route),
          freshness: { status: 'fresh', checkedAt: generatedAt },
          indexRefs: indexRefsForScope(scopeId)
        },
        scopedGraph,
        sourceInventory,
        []
      )
      return { scope, graph: scopedGraph }
    })
    .filter((entry): entry is ContextScopedGraph => Boolean(entry))
}

function finalizeScope(
  scope: Omit<ContextGraphScope, 'stats'> & { stats?: ContextGraphScope['stats'] },
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  groups: ContextSourceGroupRecord[],
  fileCount?: number
): ContextGraphScope {
  return withStats({ ...scope, stats: scope.stats ?? emptyStats() }, graph, sourceInventory, groups, fileCount)
}

function withStats(
  scope: ContextGraphScope,
  graph: ContextGraph,
  sourceInventory: ContextSourceInventory | undefined,
  groups: ContextSourceGroupRecord[],
  fileCount?: number
): ContextGraphScope {
  const files = fileCount ?? (scope.path && sourceInventory ? sourceInventory.entries.filter((entry) => pathWithin(entry.path, scope.path ?? '')).length : sourceInventory?.entries.length ?? 0)
  const groupCount = scope.path ? groups.filter((group) => pathWithin(group.path, scope.path ?? '')).length : groups.length
  return {
    ...scope,
    stats: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      diagnostics: graph.diagnostics.length,
      files,
      groups: groupCount
    }
  }
}

function withGraphScope(graph: ContextGraph, scopeId: string): ContextGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, scopeId: node.scopeId ?? scopeId })),
    edges: graph.edges.map((edge) => ({ ...edge, scopeId: edge.scopeId ?? scopeId })),
    diagnostics: graph.diagnostics
  }
}

function withNodeScope(node: ContextNode, scope: Pick<ContextGraphScope, 'id' | 'parentScopeId'>): ContextNode {
  return {
    ...node,
    scopeId: scope.id,
    parentScopeId: node.parentScopeId ?? scope.parentScopeId,
    subgraphRef: node.subgraphRef ?? `.context/graph/scopes/${slug(scope.id)}`
  }
}

function withEdgeScope(edge: ContextEdge, scopeId: string): ContextEdge {
  return {
    ...edge,
    scopeId: edge.scopeId ?? scopeId,
    properties: {
      ...edge.properties,
      scopeId: edge.properties.scopeId ?? scopeId
    }
  }
}

function sourceSnapshotNode(entry: ContextSourceInventoryEntry, scope: Pick<ContextGraphScope, 'id' | 'parentScopeId'>): ContextNode {
  return createContextNode({
    id: snapshotIdForEntry(entry),
    type: 'SourceSnapshot',
    name: entry.path,
    scopeId: scope.id,
    parentScopeId: scope.parentScopeId,
    subgraphRef: `.context/graph/scopes/${slug(scope.id)}`,
    sourceRefs: [entry.sourceRef],
    properties: {
      sourceName: entry.sourceName,
      root: entry.root,
      path: entry.path,
      mediaType: entry.mediaType,
      sizeBytes: entry.sizeBytes,
      hash: entry.hash,
      route: entry.route,
      status: entry.status,
      unsupportedReason: entry.unsupportedReason,
      sourceInventoryId: entry.id
    }
  })
}

function sourceFileNode(entry: ContextSourceInventoryEntry, scope: Pick<ContextGraphScope, 'id' | 'parentScopeId'>, fileScopeId: string): ContextNode {
  const contentScopeId = entry.status === 'routed' ? contentScopeIdForEntry(entry) : undefined
  return createContextNode({
    id: fileNodeIdForEntry(entry),
    type: 'File',
    name: fileName(entry.path),
    scopeId: scope.id,
    parentScopeId: scope.parentScopeId,
    subgraphRef: `.context/graph/scopes/${scopeDirName(fileScopeId)}`,
    sourceRefs: [entry.sourceRef],
    properties: {
      sourceName: entry.sourceName,
      root: entry.root,
      path: entry.path,
      mediaType: entry.mediaType,
      sizeBytes: entry.sizeBytes,
      hash: entry.hash,
      route: entry.route,
      status: entry.status,
      unsupportedReason: entry.unsupportedReason,
      sourceInventoryId: entry.id,
      fileScopeId,
      contentScopeId
    }
  })
}

function containsSnapshotEdges(scope: ContextGraphScope, snapshots: Map<string, ContextNode>): ContextEdge[] {
  if (!scope.rootNodeId) return []
  return [...snapshots.values()].map((snapshot) =>
    createContextEdge({
      id: `EDGE-${scope.rootNodeId}-contains-snapshot-${snapshot.id}`,
      from: scope.rootNodeId as string,
      to: snapshot.id,
      type: 'contains_snapshot',
      linker: 'graph.scope-builder',
      status: 'confirmed',
      scopeId: scope.id,
      evidence: []
    })
  )
}

function derivedFromEdges(scope: ContextGraphScope, nodes: Map<string, ContextNode>, snapshots: Map<string, ContextNode>): ContextEdge[] {
  const edges: ContextEdge[] = []
  for (const node of nodes.values()) {
    if (node.type === 'Source' || node.type === 'SourceGroup' || node.type === 'SourceSnapshot' || node.type === 'File') {
      continue
    }
    for (const sourceRef of node.sourceRefs) {
      const path = sourceRef.location?.path
      const snapshot = typeof path === 'string' ? snapshots.get(path) : undefined
      if (!snapshot) {
        continue
      }
      const evidence: Evidence[] = [evidenceFromSource('explicit_reference', `${node.id} is derived from ${path}`, [sourceRef])]
      edges.push(
        createContextEdge({
          id: `EDGE-${node.id}-derived-from-${snapshot.id}`,
          from: node.id,
          to: snapshot.id,
          type: 'derived_from',
          linker: 'graph.scope-builder',
          status: 'confirmed',
          scopeId: scope.id,
          evidence
        })
      )
    }
  }
  return edges
}

function fileChildScopeEdges(scope: ContextGraphScope, fileNodes: Map<string, ContextNode>): ContextEdge[] {
  if (!scope.rootNodeId) return []
  return [...fileNodes.values()].map((file) =>
    createContextEdge({
      id: `EDGE-${scope.rootNodeId}-has-child-scope-${file.id}`,
      from: scope.rootNodeId as string,
      to: file.id,
      type: 'has_child_scope',
      linker: 'graph.scope-builder',
      status: 'confirmed',
      scopeId: scope.id,
      evidence: file.sourceRefs.length > 0 ? [evidenceFromSource('explicit_reference', `${file.id} materializes a file scope`, file.sourceRefs)] : [],
      properties: {
        childScopeId: file.properties.fileScopeId,
        childScopeKind: 'file',
        path: file.properties.path
      }
    })
  )
}

function buildGraphChildScopeEdges(scope: ContextGraphScope, buildGraphScopeContexts: BuildGraphScopeContext[]): ContextEdge[] {
  if (!scope.rootNodeId) return []
  return buildGraphScopeContexts.map((context) =>
    createContextEdge({
      id: `EDGE-${scope.rootNodeId}-has-child-build-graph-${context.rootNode.id}`,
      from: scope.rootNodeId as string,
      to: context.rootNode.id,
      type: 'has_child_scope',
      linker: 'graph.scope-builder',
      status: 'confirmed',
      scopeId: scope.id,
      evidence: context.rootNode.sourceRefs.length > 0 ? [evidenceFromSource('explicit_reference', `${context.rootNode.id} materializes an L2 build graph`, context.rootNode.sourceRefs)] : [],
      properties: {
        childScopeId: context.scope.id,
        childScopeKind: 'build_graph',
        standardKind: context.buildUnit.standardKind,
        adapterId: context.buildUnit.adapterId
      }
    })
  )
}

function buildGraphContainsEdges(context: BuildGraphScopeContext, selectedNodes: Map<string, ContextNode>): ContextEdge[] {
  return [...selectedNodes.values()]
    .filter((node) => node.id !== context.rootNode.id)
    .map((node) =>
      createContextEdge({
        id: `EDGE-${context.rootNode.id}-contains-${node.id}`,
        from: context.rootNode.id,
        to: node.id,
        type: 'contains',
        linker: 'graph.scope-builder',
        status: 'confirmed',
        scopeId: context.scope.id,
        evidence: node.sourceRefs.length > 0 ? [evidenceFromSource('explicit_reference', `${node.id} is part of ${context.rootNode.name}`, node.sourceRefs)] : [],
        properties: {
          standardKind: context.buildUnit.standardKind,
          adapterId: context.buildUnit.adapterId
        }
      })
    )
}

function contentChildScopeEdge(scopeId: string, file: ContextNode, contentRoot: ContextNode, childScopeId: string, path: string): ContextEdge {
  return createContextEdge({
    id: `EDGE-${file.id}-has-child-scope-${slug(childScopeId)}`,
    from: file.id,
    to: contentRoot.id,
    type: 'has_child_scope',
    linker: 'graph.scope-builder',
    status: 'confirmed',
    scopeId,
    evidence: file.sourceRefs.length > 0 ? [evidenceFromSource('explicit_reference', `${file.id} materializes a content scope`, file.sourceRefs)] : [],
    properties: {
      childScopeId,
      childScopeKind: 'content',
      path
    }
  })
}

function childScopeEdges(scope: ContextGraphScope, groups: ContextSourceGroupRecord[]): ContextEdge[] {
  if (!scope.sourceGroupId || !scope.path || !scope.rootNodeId) return []
  return groups
    .filter((group) => group.id !== scope.sourceGroupId && pathWithin(group.path, scope.path ?? ''))
    .filter((group) => parentGroupFor(group, groups)?.id === scope.sourceGroupId)
    .map((group) =>
      createContextEdge({
        id: `EDGE-${scope.rootNodeId}-has-child-scope-${group.id}`,
        from: scope.rootNodeId as string,
        to: group.id,
        type: 'has_child_scope',
        linker: 'graph.scope-builder',
        status: 'confirmed',
        scopeId: scope.id,
        evidence: [],
        properties: {
          childScopeId: scopeIdForSourceGroup(group.id)
        }
      })
    )
}

function buildGraphScopeForEntry(
  entry: ContextSourceInventoryEntry,
  groupScope: ContextGraphScope | undefined,
  buildGraphScopeContexts: BuildGraphScopeContext[]
): ContextGraphScope | undefined {
  const candidates = buildGraphScopeContexts.filter((context) => context.scope.sourceGroupId === groupScope?.sourceGroupId)
  if (candidates.length === 0) {
    return undefined
  }
  if (candidates.length === 1) {
    return candidates[0]?.scope
  }
  const standardKind = standardKindForRoute(entry.route)
  return candidates.find((context) => context.buildUnit.standardKind === standardKind)?.scope ?? candidates.find((context) => context.buildUnit.standardKind === 'inventory')?.scope ?? candidates[0]?.scope
}

function indexRefsForScope(scopeId: string): Record<string, string> {
  const dir = `.context/index/scopes/${slug(scopeId)}`
  return {
    graph: `${dir}/graph.sqlite`,
    symbols: `${dir}/symbols.sqlite`,
    apis: `${dir}/api.sqlite`,
    docs: `${dir}/docs.sqlite`,
    tests: `${dir}/tests.sqlite`,
    runtime: `${dir}/runtime.sqlite`,
    fts: `${dir}/fts.sqlite`,
    fingerprints: `${dir}/fingerprints.sqlite`
  }
}

export function scopeIdForSourceGroup(groupId: string): string {
  return `scope:source-group:${slug(groupId)}`
}

export function scopeIdForPackage(packageId: string): string {
  return `scope:package:${slug(packageId)}`
}

export function scopeIdForBuildGraph(groupId: string, buildUnitId: string, standardKind: ContextPackageBuildUnit['standardKind']): string {
  return `scope:build-graph:${slug(`${groupId}:${buildUnitId}:${standardKind}`)}`
}

export function scopeDirName(scopeId: string): string {
  return slug(scopeId)
}

function fileScopeIdForEntry(entry: ContextSourceInventoryEntry): string {
  return `scope:file:${slug(entry.id)}`
}

function contentScopeIdForEntry(entry: ContextSourceInventoryEntry): string {
  return `scope:content:${slug(entry.id)}`
}

function fileNodeIdForEntry(entry: ContextSourceInventoryEntry): string {
  return `FILE-${entry.hash.slice(0, 16)}`
}

function snapshotIdForEntry(entry: ContextSourceInventoryEntry): string {
  return `SNAPSHOT-${entry.hash.slice(0, 16)}`
}

function nodeWithinGroup(node: ContextNode, groupPath: string): boolean {
  return node.sourceRefs.some((sourceRef) => typeof sourceRef.location?.path === 'string' && pathWithin(sourceRef.location.path, groupPath))
}

function directNodeWithinGroup(node: ContextNode, sourceGroupId: string | undefined, groupPath: string, groups: ContextSourceGroupRecord[]): boolean {
  if (node.type === 'Source' || node.type === 'SourceGroup' || node.type === 'SourceSnapshot' || node.type === 'File') {
    return false
  }
  return node.sourceRefs.some((sourceRef) => {
    const path = sourceRef.location?.path
    if (typeof path !== 'string' || !pathWithin(path, groupPath)) {
      return false
    }
    const nearest = nearestGroupForPath(path, groups)
    return nearest ? nearest.id === sourceGroupId : true
  })
}

function directChildGroupWithin(node: ContextNode, sourceGroupId: string | undefined, groupPath: string, groups: ContextSourceGroupRecord[]): boolean {
  if (node.type !== 'SourceGroup' || typeof node.properties.path !== 'string') {
    return false
  }
  const child = groups.find((group) => group.id === node.id || group.path === node.properties.path)
  if (!child || !pathWithin(child.path, groupPath)) {
    return false
  }
  return parentGroupFor(child, groups)?.id === sourceGroupId
}

function directEntriesWithinGroup(
  sourceInventory: ContextSourceInventory | undefined,
  sourceGroupId: string | undefined,
  groupPath: string,
  groups: ContextSourceGroupRecord[]
): ContextSourceInventoryEntry[] {
  return (sourceInventory?.entries ?? []).filter((entry) => {
    if (entry.status === 'skipped' || !pathWithin(entry.path, groupPath)) {
      return false
    }
    const nearest = nearestGroupForPath(entry.path, groups)
    return nearest ? nearest.id === sourceGroupId : true
  })
}

function nearestGroupForPath(path: string, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups.filter((group) => pathWithin(path, group.path)).sort((left, right) => right.path.length - left.path.length)[0]
}

function parentGroupFor(group: ContextSourceGroupRecord, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups
    .filter((candidate) => candidate.id !== group.id && pathWithin(group.path, candidate.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function adapterRefsForRoute(route: string): ContextGraphAdapterRef[] {
  if (route === 'code') {
    return [selectedAdapter(CODE_GRAPH_ADAPTER_ID, 'code-graph-builder', 'Default file adapter for code routes.')]
  }
  if (route === 'markdown') {
    return [selectedAdapter('builtin.markdown-text', 'semantic-graph-builder', 'Default file adapter for markdown routes.')]
  }
  if (route === 'openapi') {
    return [selectedAdapter('builtin.openapi', 'semantic-graph-builder', 'Default file adapter for OpenAPI routes.')]
  }
  return [inventoryAdapter(`Default inventory adapter for ${route} routes.`)]
}

function adapterRefsForSourceGroupKind(kind: ContextSourceGroupKind): ContextGraphAdapterRef[] {
  const inventory = inventoryAdapter(`Default source inventory adapter for ${kind} source groups.`)
  switch (kind) {
    case 'repository':
      return [inventory, selectedAdapter(CODE_GRAPH_ADAPTER_ID, 'code-graph-builder', 'Default code graph adapter for repository source groups.')]
    case 'doc_bundle':
    case 'analysis_bundle':
    case 'domain_area':
      return [inventory, selectedAdapter('microsoft-graphrag.graph-adapter', 'semantic-graph-builder', `Default semantic corpus adapter for ${kind} source groups.`)]
    case 'api_bundle':
      return [inventory, selectedAdapter('builtin.openapi', 'semantic-graph-builder', 'Default API contract adapter for api_bundle source groups.')]
    case 'test_bundle':
      return [inventory, selectedAdapter('microsoft-graphrag.graph-adapter', 'semantic-graph-builder', 'Default semantic corpus adapter for test_bundle source groups.')]
    default:
      return [inventory]
  }
}

function adapterRefsForPackage(record: ContextPackageRecord): ContextGraphAdapterRef[] {
  const refs = [inventoryAdapter(`Default source inventory adapter for ${record.kind} packages.`)]
  for (const unit of record.buildUnits) {
    refs.push(unit.adapterSelection ?? selectedAdapter(unit.adapterId, 'inventory', `Default adapter for ${unit.standardKind} build units.`))
  }
  return dedupeAdapterRefs(refs)
}

function standardKindForSourceGroupKind(kind: ContextSourceGroupKind): ContextPackageBuildUnit['standardKind'] {
  if (kind === 'repository') return 'repository'
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area' || kind === 'test_bundle') return 'semantic_corpus'
  if (kind === 'api_bundle') return 'api_contracts'
  return 'inventory'
}

function standardKindForRoute(route: ContextSourceInventoryEntry['route']): ContextPackageBuildUnit['standardKind'] {
  if (route === 'code') return 'repository'
  if (route === 'markdown') return 'semantic_corpus'
  if (route === 'openapi') return 'api_contracts'
  return 'inventory'
}

function buildUnitKindForStandardKind(kind: ContextPackageBuildUnit['standardKind']): ContextPackageBuildUnit['kind'] {
  if (kind === 'repository') return 'repository'
  if (kind === 'semantic_corpus') return 'graphrag_corpus'
  if (kind === 'api_contracts') return 'api_contracts'
  return 'inventory'
}

function roleForStandardKind(kind: ContextPackageBuildUnit['standardKind']): ContextGraphAdapterRef['role'] {
  if (kind === 'repository') return 'code-graph-builder'
  if (kind === 'inventory') return 'inventory'
  return 'semantic-graph-builder'
}

function nodeTypeForStandardKind(kind: ContextPackageBuildUnit['standardKind']): ContextNode['type'] {
  if (kind === 'repository') return 'RepositoryGraph'
  if (kind === 'semantic_corpus') return 'SemanticCorpusGraph'
  if (kind === 'api_contracts') return 'ApiContractGraph'
  return 'InventoryGraph'
}

function buildGraphTitle(kind: ContextPackageBuildUnit['standardKind'], title: string): string {
  switch (kind) {
    case 'repository':
      return `代码图: ${title}`
    case 'semantic_corpus':
      return `语义资料图: ${title}`
    case 'api_contracts':
      return `API 合同图: ${title}`
    default:
      return `资料清单图: ${title}`
  }
}

function buildGraphSummary(kind: ContextPackageBuildUnit['standardKind'], title: string): string {
  switch (kind) {
    case 'repository':
      return `${title} 的 L2 代码仓库标准图。`
    case 'semantic_corpus':
      return `${title} 的 L2 语义资料标准图。`
    case 'api_contracts':
      return `${title} 的 L2 API 合同标准图。`
    default:
      return `${title} 的 L2 清单标准图。`
  }
}

function buildGraphNodeId(groupId: string, buildUnit: ContextPackageBuildUnit): string {
  return `BUILD-GRAPH-${slug(`${groupId}:${buildUnit.id}:${buildUnit.standardKind}`)}`
}

function inventoryAdapter(selectionReason: string): ContextGraphAdapterRef {
  return selectedAdapter('builtin.source-inventory', 'inventory', selectionReason)
}

function selectedAdapter(adapterId: string, role: ContextGraphAdapterRef['role'], selectionReason: string): ContextGraphAdapterRef {
  return {
    adapterId,
    role,
    selectionSource: 'default',
    selectionReason,
    priority: role === 'inventory' ? -1 : 0
  }
}

function dedupeAdapterRefs(refs: ContextGraphAdapterRef[]): ContextGraphAdapterRef[] {
  return [...new Map(refs.map((ref) => [`${ref.adapterId}:${ref.role}`, ref])).values()]
}

function packageKind(value: string | undefined): ContextPackageKind {
  if (
    value === 'product_docs' ||
    value === 'code_repository' ||
    value === 'api_contracts' ||
    value === 'test_materials' ||
    value === 'analysis' ||
    value === 'design' ||
    value === 'data' ||
    value === 'runtime' ||
    value === 'asset' ||
    value === 'unknown'
  ) {
    return value
  }
  return 'unknown'
}

function packageForGroup(group: ContextSourceGroupRecord, packages: ContextPackageRecord[]): ContextPackageRecord | undefined {
  return packages.find((record) => record.sourceGroupIds.includes(group.id))
}

function stringProperty(node: ContextNode, key: string): string | undefined {
  const value = node.properties[key]
  return typeof value === 'string' ? value : undefined
}

function stringArrayProperty(node: ContextNode, key: string): string[] {
  const value = node.properties[key]
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function sourceGroupKind(value: string | undefined): ContextSourceGroupKind {
  if (
    value === 'repository' ||
    value === 'doc_bundle' ||
    value === 'asset_bundle' ||
    value === 'analysis_bundle' ||
    value === 'domain_area' ||
    value === 'data_bundle' ||
    value === 'api_bundle' ||
    value === 'design_bundle' ||
    value === 'test_bundle' ||
    value === 'config_bundle' ||
    value === 'runtime_bundle' ||
    value === 'vendor_bundle' ||
    value === 'generated_bundle' ||
    value === 'archive' ||
    value === 'unknown'
  ) {
    return value
  }
  return 'unknown'
}

function boundaryMode(node: ContextNode): ContextGraphScope['boundaryMode'] {
  const value = node.properties.boundaryMode
  return value === 'expanded' || value === 'collapsed' || value === 'repository' ? value : undefined
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function fileName(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? path
}

function dedupeNodes(nodes: ContextNode[]): ContextNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
}

function dedupeEdges(edges: ContextEdge[]): ContextEdge[] {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()]
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

function emptyStats(): ContextGraphScope['stats'] {
  return { nodes: 0, edges: 0, diagnostics: 0, files: 0, groups: 0 }
}

export const BUILTIN_GRAPH_ADAPTERS: GraphAdapterManifest[] = [
  {
    id: 'builtin.source-inventory',
    title: 'Built-in source inventory adapter',
    version: '0.1.0',
    scopeKinds: ['project', 'source_group', 'file'],
    inputs: ['source-inventory'],
    outputs: ['ContextGraphScope', 'File', 'SourceSnapshot'],
    deterministic: true,
    requiresNetwork: false,
    stability: 'development'
  },
  {
    id: 'builtin.markdown-text',
    title: 'Built-in markdown/text graph adapter',
    version: '0.1.0',
    scopeKinds: ['source_group', 'file', 'content'],
    sourceGroupKinds: ['doc_bundle', 'analysis_bundle', 'domain_area'],
    inputs: ['RawArtifact:text/markdown'],
    outputs: ['Document', 'Requirement', 'BusinessRule', 'Decision', 'Risk'],
    deterministic: true,
    requiresNetwork: false,
    stability: 'development',
    externalProjects: ['Docling', 'Marker', 'Unstructured', 'Microsoft GraphRAG', 'LightRAG']
  },
  {
    id: CODE_GRAPH_ADAPTER_ID,
    title: 'CodeGraph graph adapter',
    version: '0.1.0',
    scopeKinds: ['source_group', 'file', 'content'],
    sourceGroupKinds: ['repository', 'test_bundle'],
    inputs: ['RawArtifact:code'],
    outputs: ['CodeSymbol', 'Module', 'ExternalAPI', 'ContextEdge', 'ContextGraphIndexHint', 'GraphAdapterArtifact'],
    deterministic: true,
    requiresNetwork: false,
    stability: 'development',
    externalProjects: ['CodeGraph', 'Understand-Anything', 'code-review-graph', 'Tree-sitter', 'JavaParser', 'Spoon'],
    metadata: { backend: 'typescript-estree' }
  },
  {
    id: 'builtin.openapi',
    title: 'Built-in API graph adapter',
    version: '0.1.0',
    scopeKinds: ['source_group', 'file', 'content'],
    sourceGroupKinds: ['api_bundle'],
    inputs: ['ParsedArtifact:openapi'],
    outputs: ['APIEndpoint'],
    deterministic: true,
    requiresNetwork: false,
    stability: 'development'
  },
  {
    id: 'builtin.runtime-provider',
    title: 'Built-in runtime provider graph adapter',
    version: '0.1.0',
    scopeKinds: ['source_group'],
    sourceGroupKinds: ['data_bundle', 'runtime_bundle'],
    inputs: ['source-inventory'],
    outputs: ['ContextRuntimeProvider'],
    deterministic: true,
    requiresNetwork: false,
    stability: 'development'
  }
]
