import { basename, dirname, extname } from 'node:path'
import type {
  ContextEdge,
  ContextGraph,
  ContextNode,
  Diagnostic,
  Evidence,
  EvidenceFinding,
  EvidenceReport,
  GraphFactKind,
  GraphFactProvenance,
  GraphPatch,
  GraphPatchApplicationResult,
  GraphRevision,
  PatchOperation,
  PlanningPack,
  PlanningPackCandidate,
  RehomeProposal
} from '../contracts/graph.js'
import type {
  ContextSourceInventory
} from '../contracts/sources.js'
import type {
  SourceRef
} from '../contracts/config.js'
import { createDiagnostic } from '../diagnostics/index.js'
import { createContextEdge, createContextNode, fingerprintValue, slug } from '../graph/model.js'
import { createGraphRevision } from '../graph/revisions.js'

export { PIPELINE_STAGES } from '../contracts/pipeline.js'
export type * from '../contracts/pipeline.js'
export type {
  ContextEdge,
  ContextGraph,
  ContextNode,
  Diagnostic,
  Evidence,
  EvidenceFinding,
  EvidenceReport,
  GraphFactKind,
  GraphFactProvenance,
  GraphPatch,
  GraphPatchApplicationResult,
  GraphRevision,
  PatchOperation,
  PlanningPack,
  PlanningPackCandidate,
  RehomeProposal
} from '../contracts/graph.js'
export type { ContextSourceInventory } from '../contracts/sources.js'
export type { SourceRef } from '../contracts/config.js'
export * from '../pipeline/index.js'

export interface ApplyGraphPatchResult {
  graph: ContextGraph
  revision: GraphRevision
  appliedPatch: GraphPatch
  rehomeProposals: RehomeProposal[]
}

export interface ApplyGraphPatchBatchResult {
  graph: ContextGraph
  revision?: GraphRevision
  appliedPatches: GraphPatch[]
  rejectedPatches: GraphPatch[]
  diagnostics: Diagnostic[]
  rehomeProposals: RehomeProposal[]
}

export interface PlanningPackOptions {
  maxCandidates?: number
  maxRepresentativeFiles?: number
  generatedAt?: string
}

export interface ReconcileEvidenceResult {
  patches: GraphPatch[]
  rehomeProposals: RehomeProposal[]
}

/** Apply a proposed graph patch into a new graph and revision without mutating the input graph. */
export function applyGraphPatch(graph: ContextGraph, patch: GraphPatch, baseRevision: GraphRevision): ApplyGraphPatchResult {
  const result = applyGraphPatchBatch(graph, baseRevision, [patch])
  const appliedPatch = result.appliedPatches[0]
  if (!result.revision || !appliedPatch) {
    const message = result.diagnostics.map((diagnostic) => diagnostic.message).join('; ') || `Graph patch ${patch.id} was not applied.`
    throw new Error(message)
  }
  return { graph: result.graph, revision: result.revision, appliedPatch, rehomeProposals: result.rehomeProposals }
}

/** Validate one proposed graph patch against the current canonical graph revision. */
export function validateGraphPatch(graph: ContextGraph, revision: GraphRevision, patch: GraphPatch): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!patch || patch.schemaVersion !== 'context-graph-patch.v1' || typeof patch.id !== 'string' || typeof patch.revisionId !== 'string' || !Array.isArray(patch.operations)) {
    diagnostics.push(patchDiagnostic('graph.patch.invalid-schema', patch?.id ?? 'unknown', 'Graph patch does not match context-graph-patch.v1.'))
    return diagnostics
  }
  if (patch.revisionId !== revision.id) {
    diagnostics.push(patchDiagnostic('graph.patch.stale-revision', patch.id, `Graph patch ${patch.id} targets ${patch.revisionId}, current revision is ${revision.id}.`))
  }
  if (patch.operations.length === 0) {
    diagnostics.push(patchDiagnostic('graph.patch.noop', patch.id, `Graph patch ${patch.id} has no operations.`))
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const edgeIds = new Set(graph.edges.map((edge) => edge.id))
  const newNodeIds = new Set<string>()
  const newEdgeIds = new Set<string>()
  for (const operation of patch.operations) {
    switch (operation.op) {
      case 'add_node':
        if (nodeIds.has(operation.node.id) || newNodeIds.has(operation.node.id)) {
          diagnostics.push(patchDiagnostic('graph.patch.duplicate-id', patch.id, `Graph patch ${patch.id} adds duplicate node id ${operation.node.id}.`, operation.node.id))
        }
        newNodeIds.add(operation.node.id)
        break
      case 'add_edge':
      case 'link':
        if (edgeIds.has(operation.edge.id) || newEdgeIds.has(operation.edge.id)) {
          diagnostics.push(patchDiagnostic('graph.patch.duplicate-id', patch.id, `Graph patch ${patch.id} adds duplicate edge id ${operation.edge.id}.`))
        }
        if (!nodeIds.has(operation.edge.from) && !newNodeIds.has(operation.edge.from)) {
          diagnostics.push(patchDiagnostic('graph.patch.missing-edge-endpoint', patch.id, `Graph patch ${patch.id} edge ${operation.edge.id} references missing from node ${operation.edge.from}.`, operation.edge.from))
        }
        if (!nodeIds.has(operation.edge.to) && !newNodeIds.has(operation.edge.to)) {
          diagnostics.push(patchDiagnostic('graph.patch.missing-edge-endpoint', patch.id, `Graph patch ${patch.id} edge ${operation.edge.id} references missing to node ${operation.edge.to}.`, operation.edge.to))
        }
        newEdgeIds.add(operation.edge.id)
        break
      case 'update_node':
      case 'deprecate_node':
      case 'relabel_source_group':
      case 'reparent_node':
      case 'restore_node_snapshot':
        {
          const nodeId = operation.op === 'restore_node_snapshot' ? operation.node.id : operation.nodeId
          if (!nodeIds.has(nodeId) && !newNodeIds.has(nodeId)) {
            diagnostics.push(patchDiagnostic('graph.patch.missing-node', patch.id, `Graph patch ${patch.id} references missing node ${nodeId}.`, nodeId))
          }
        }
        break
      case 'deprecate_edge':
        if (!edgeIds.has(operation.edgeId) && !newEdgeIds.has(operation.edgeId)) {
          diagnostics.push(patchDiagnostic('graph.patch.missing-edge', patch.id, `Graph patch ${patch.id} references missing edge ${operation.edgeId}.`, operation.edgeId))
        }
        break
      case 'rehome_proposal':
        break
      default:
        diagnostics.push(patchDiagnostic('graph.patch.invalid-schema', patch.id, `Graph patch ${patch.id} contains an unknown operation.`))
    }
  }
  return diagnostics
}

/** Apply a stable batch of valid graph patches into one new revision. Invalid patches are rejected. */
export function applyGraphPatchBatch(graph: ContextGraph, baseRevision: GraphRevision, patches: GraphPatch[]): ApplyGraphPatchBatchResult {
  let nodes = graph.nodes.map(cloneNode)
  let edges = graph.edges.map(cloneEdge)
  const diagnostics: Diagnostic[] = []
  const appliedPatches: GraphPatch[] = []
  const rejectedPatches: GraphPatch[] = []
  const rehomeProposals: RehomeProposal[] = []
  const seenPatchIds = new Set<string>()

  for (const patch of [...patches].sort(byPatchOrder)) {
    const patchDiagnostics = validateGraphPatch({ nodes, edges, diagnostics: graph.diagnostics }, baseRevision, patch)
    if (seenPatchIds.has(patch.id)) {
      patchDiagnostics.push(patchDiagnostic('graph.patch.duplicate-id', patch.id, `Duplicate graph patch id ${patch.id}.`))
    }
    seenPatchIds.add(patch.id)
    if (patchDiagnostics.length > 0) {
      diagnostics.push(...patchDiagnostics)
      rejectedPatches.push({ ...patch, status: 'rejected' })
      continue
    }

    const applicationResults: GraphPatchApplicationResult[] = []
    for (const [operationIndex, operation] of patch.operations.entries()) {
      const result = applyOperation(nodes, edges, operation, baseRevision, patch.id, operationIndex)
      nodes = result.nodes
      edges = result.edges
      if (result.proposal) {
        rehomeProposals.push(result.proposal)
      }
      if (result.applicationResult) {
        applicationResults.push(result.applicationResult)
      }
    }
    appliedPatches.push({ ...patch, status: 'applied', applicationResults })
  }

  if (appliedPatches.length === 0) {
    return { graph, appliedPatches, rejectedPatches, diagnostics, rehomeProposals }
  }

  const nextGraph = {
    nodes: nodes.sort(byId),
    edges: edges.sort(byId),
    diagnostics: [...graph.diagnostics, ...diagnostics]
  }
  const revision = createGraphRevision(nextGraph, {
    parentRevisionId: baseRevision.id,
    reason: `Applied ${appliedPatches.length} graph patch${appliedPatches.length === 1 ? '' : 'es'}`,
    patchIds: [...baseRevision.patchIds, ...appliedPatches.map((patch) => patch.id)],
    evidenceReportIds: unique([...baseRevision.evidenceReportIds, ...appliedPatches.flatMap((patch) => patch.evidenceReportIds ?? [])])
  })
  const appliedAt = revision.createdAt
  const ledgerPatches = appliedPatches.map((patch) => ({
    ...patch,
    appliedAt,
    appliedRevisionId: revision.id,
    applicationResults: patch.applicationResults?.map((result) => hydrateApplicationResult(result, nextGraph))
  }))
  const provenanceByFactId = buildPatchProvenance(ledgerPatches, baseRevision, revision)
  nextGraph.nodes = nextGraph.nodes.map((node) => appendFactProvenance(node, provenanceByFactId.get(node.id)))
  nextGraph.edges = nextGraph.edges.map((edge) => appendFactProvenance(edge, provenanceByFactId.get(edge.id)))
  return { graph: nextGraph, revision, appliedPatches: ledgerPatches, rejectedPatches, diagnostics, rehomeProposals }
}

function applyOperation(
  nodes: ContextGraph['nodes'],
  edges: ContextGraph['edges'],
  operation: PatchOperation,
  baseRevision: GraphRevision,
  patchId: string,
  operationIndex: number
): { nodes: ContextGraph['nodes']; edges: ContextGraph['edges']; proposal?: RehomeProposal; applicationResult?: GraphPatchApplicationResult } {
  switch (operation.op) {
    case 'add_node': {
      const nextNode = cloneNode(operation.node)
      return {
        nodes: upsertById(nodes, nextNode),
        edges,
        applicationResult: applicationResult(patchId, operationIndex, operation.op, 'node', nextNode.id, undefined, nextNode)
      }
    }
    case 'add_edge':
    case 'link': {
      const nextEdge = cloneEdge(operation.edge)
      return {
        nodes,
        edges: upsertById(edges, nextEdge),
        applicationResult: applicationResult(patchId, operationIndex, operation.op, 'edge', nextEdge.id, undefined, nextEdge)
      }
    }
    case 'update_node': {
      const previousNode = nodes.find((node) => node.id === operation.nodeId)
      const nextNodes = nodes.map((node) =>
        node.id === operation.nodeId
          ? updateNode(node, {
              name: operation.name,
              status: operation.status,
              confidence: operation.confidence,
              properties: operation.properties
            })
          : node
      )
      const nextNode = nextNodes.find((node) => node.id === operation.nodeId)
      return {
        nodes: nextNodes,
        edges,
        applicationResult: nextNode ? applicationResult(patchId, operationIndex, operation.op, 'node', operation.nodeId, previousNode, nextNode) : undefined
      }
    }
    case 'deprecate_node': {
      const previousNode = nodes.find((node) => node.id === operation.nodeId)
      const nextNodes = nodes.map((node) =>
        node.id === operation.nodeId
          ? updateNode(node, {
              status: operation.supersededBy ? 'superseded' : 'deprecated',
              properties: {
                supersededBy: operation.supersededBy,
                deprecationReason: operation.reason,
                previousRevisionId: baseRevision.id
              }
            })
          : node
      )
      const nextNode = nextNodes.find((node) => node.id === operation.nodeId)
      return {
        nodes: nextNodes,
        edges,
        applicationResult: nextNode ? applicationResult(patchId, operationIndex, operation.op, 'node', operation.nodeId, previousNode, nextNode) : undefined
      }
    }
    case 'deprecate_edge': {
      const previousEdge = edges.find((edge) => edge.id === operation.edgeId)
      const nextEdges = edges.map((edge) =>
        edge.id === operation.edgeId
          ? updateEdge(edge, {
              status: 'deprecated',
              properties: {
                supersededBy: operation.supersededBy,
                deprecationReason: operation.reason,
                previousRevisionId: baseRevision.id
              }
            })
          : edge
      )
      const nextEdge = nextEdges.find((edge) => edge.id === operation.edgeId)
      return {
        nodes,
        edges: nextEdges,
        applicationResult: nextEdge ? applicationResult(patchId, operationIndex, operation.op, 'edge', operation.edgeId, previousEdge, nextEdge) : undefined
      }
    }
    case 'restore_node_snapshot': {
      const previousNode = nodes.find((node) => node.id === operation.node.id)
      const nextNode = cloneNode(operation.node)
      return {
        nodes: upsertById(nodes, nextNode),
        edges,
        applicationResult: applicationResult(patchId, operationIndex, operation.op, 'node', operation.node.id, previousNode, nextNode)
      }
    }
    case 'relabel_source_group': {
      const previousNode = nodes.find((node) => node.id === operation.nodeId)
      const nextNodes = nodes.map((node) =>
        node.id === operation.nodeId
          ? updateNode(node, {
              name: operation.title,
              status: 'provisional',
              confidence: operation.confidence,
              properties: {
                kind: operation.kind,
                summary: operation.summary,
                previousRevisionId: baseRevision.id
              }
            })
          : node
      )
      const nextNode = nextNodes.find((node) => node.id === operation.nodeId)
      return {
        nodes: nextNodes,
        edges,
        applicationResult: nextNode ? applicationResult(patchId, operationIndex, operation.op, 'node', operation.nodeId, previousNode, nextNode) : undefined
      }
    }
    case 'reparent_node': {
      const previousNode = nodes.find((node) => node.id === operation.nodeId)
      const nextNodes = nodes.map((node) =>
        node.id === operation.nodeId
          ? updateNode(node, {
              parentScopeId: operation.parentScopeId,
              properties: { sourceGroupId: operation.sourceGroupId, previousRevisionId: baseRevision.id }
            })
          : node
      )
      const nextNode = nextNodes.find((node) => node.id === operation.nodeId)
      return {
        nodes: nextNodes,
        edges,
        applicationResult: nextNode ? applicationResult(patchId, operationIndex, operation.op, 'node', operation.nodeId, previousNode, nextNode) : undefined
      }
    }
    case 'rehome_proposal':
      return { nodes, edges, proposal: operation.proposal }
  }
}

function updateNode(
  node: ContextNode,
  patch: {
    name?: string
    status?: ContextNode['status']
    confidence?: number
    parentScopeId?: string
    properties?: Record<string, unknown>
  }
): ContextNode {
  const properties = { ...node.properties, ...(patch.properties ?? {}) }
  return {
    ...node,
    name: patch.name ?? node.name,
    status: patch.status ?? node.status,
    confidence: patch.confidence ?? node.confidence,
    parentScopeId: patch.parentScopeId ?? node.parentScopeId,
    properties,
    fingerprint: fingerprintValue({
      id: node.id,
      type: node.type,
      name: patch.name ?? node.name,
      status: patch.status ?? node.status,
      confidence: patch.confidence ?? node.confidence,
      properties
    })
  }
}

function updateEdge(
  edge: ContextEdge,
  patch: {
    status?: ContextEdge['status']
    properties?: Record<string, unknown>
  }
): ContextEdge {
  const properties = { ...edge.properties, ...(patch.properties ?? {}) }
  return {
    ...edge,
    status: patch.status ?? edge.status,
    properties,
    fingerprint: fingerprintValue({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      status: patch.status ?? edge.status,
      evidence: edge.evidence,
      properties
    })
  }
}

function cloneNode(node: ContextNode): ContextNode {
  return {
    ...node,
    properties: { ...node.properties },
    tags: [...node.tags],
    sourceRefs: [...node.sourceRefs],
    provenance: [...(node.provenance ?? [])]
  }
}

function cloneEdge(edge: ContextEdge): ContextEdge {
  return {
    ...edge,
    properties: { ...edge.properties },
    evidence: edge.evidence.map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] })),
    provenance: [...(edge.provenance ?? [])]
  }
}

function applicationResult(
  patchId: string,
  operationIndex: number,
  operation: PatchOperation['op'],
  factKind: GraphFactKind,
  factId: string,
  previous: ContextNode | ContextEdge | undefined,
  next: ContextNode | ContextEdge
): GraphPatchApplicationResult {
  const base = {
    schemaVersion: 'context-graph-patch-application-result.v1' as const,
    patchId,
    operationIndex,
    operation,
    factKind,
    factId
  }
  return factKind === 'node'
    ? {
        ...base,
        previousNode: previous ? cloneNode(previous as ContextNode) : undefined,
        nextNode: cloneNode(next as ContextNode)
      }
    : {
        ...base,
        previousEdge: previous ? cloneEdge(previous as ContextEdge) : undefined,
        nextEdge: cloneEdge(next as ContextEdge)
      }
}

function hydrateApplicationResult(result: GraphPatchApplicationResult, graph: ContextGraph): GraphPatchApplicationResult {
  if (result.factKind === 'node' && result.factId && !result.nextNode) {
    const nextNode = graph.nodes.find((node) => node.id === result.factId)
    return nextNode ? { ...result, nextNode: cloneNode(nextNode) } : result
  }
  if (result.factKind === 'edge' && result.factId && !result.nextEdge) {
    const nextEdge = graph.edges.find((edge) => edge.id === result.factId)
    return nextEdge ? { ...result, nextEdge: cloneEdge(nextEdge) } : result
  }
  return result
}

function buildPatchProvenance(patches: GraphPatch[], baseRevision: GraphRevision, revision: GraphRevision): Map<string, GraphFactProvenance[]> {
  const provenanceByFactId = new Map<string, GraphFactProvenance[]>()
  for (const patch of patches) {
    for (const result of patch.applicationResults ?? []) {
      if (!result.factKind || !result.factId) {
        continue
      }
      const evidence = evidenceForApplicationResult(patch, result)
      const provenance: GraphFactProvenance = {
        schemaVersion: 'context-graph-fact-provenance.v1',
        id: `PROV-${fingerprintValue({
          factId: result.factId,
          revisionId: revision.id,
          patchId: patch.id,
          operationIndex: result.operationIndex
        }).slice(0, 16)}`,
        factKind: result.factKind,
        factId: result.factId,
        revisionId: revision.id,
        previousRevisionId: baseRevision.id,
        patchId: patch.id,
        operation: result.operation,
        operationIndex: result.operationIndex,
        author: patch.author,
        evidenceReportIds: patch.evidenceReportIds ?? [],
        findingTypes: findingTypesForApplicationResult(result),
        evidence,
        sourceRefs: uniqueSourceRefs([
          ...sourceRefsForEvidence(evidence),
          ...(result.nextNode?.sourceRefs ?? []),
          ...sourceRefsForEvidence(result.nextEdge?.evidence ?? [])
        ]),
        status: 'applied',
        createdAt: patch.appliedAt ?? revision.createdAt
      }
      provenanceByFactId.set(result.factId, [...(provenanceByFactId.get(result.factId) ?? []), provenance])
    }
  }
  return provenanceByFactId
}

function appendFactProvenance<T extends ContextNode | ContextEdge>(fact: T, provenance: GraphFactProvenance[] | undefined): T {
  if (!provenance || provenance.length === 0) {
    return fact
  }
  const byId = new Map<string, GraphFactProvenance>()
  for (const item of fact.provenance ?? []) {
    byId.set(item.id, item)
  }
  for (const item of provenance) {
    byId.set(item.id, item)
  }
  return { ...fact, provenance: [...byId.values()] }
}

function evidenceForApplicationResult(patch: GraphPatch, result: GraphPatchApplicationResult): Evidence[] {
  return [
    ...patch.evidence,
    ...(result.nextEdge?.evidence ?? []),
    ...(result.previousEdge?.evidence ?? [])
  ]
}

function findingTypesForApplicationResult(result: GraphPatchApplicationResult): EvidenceFinding['type'][] {
  switch (result.operation) {
    case 'link':
      return ['link_groups']
    case 'relabel_source_group':
      return ['relabel_group']
    case 'deprecate_node':
      return ['merge_group']
    case 'reparent_node':
      return ['misplaced_source']
    case 'add_node':
      return result.nextNode?.type === 'SourceGroup' ? ['split_group'] : []
    case 'add_edge':
      return result.nextEdge?.type === 'contains_group' ? ['split_group'] : []
    case 'update_node':
      return result.nextNode?.properties.confirmedBy === 'evidence-report' ? ['confirm_fact'] : []
    default:
      return []
  }
}

function uniqueSourceRefs(sourceRefs: SourceRef[]): SourceRef[] {
  const refs = new Map<string, SourceRef>()
  for (const ref of sourceRefs) {
    refs.set(`${ref.sourceId}:${ref.uri}:${ref.location?.path ?? ''}`, ref)
  }
  return [...refs.values()]
}

/** Build the bounded planning pack given to agents instead of the full inventory. */
export function buildPlanningPack(inventory: ContextSourceInventory, options: PlanningPackOptions = {}): PlanningPack {
  const maxCandidates = options.maxCandidates ?? 24
  const maxRepresentativeFiles = options.maxRepresentativeFiles ?? 8
  const candidates = candidateDirectories(inventory)
    .map((path) => planningCandidate(path, inventory, maxRepresentativeFiles))
    .filter((candidate) => candidate.fileCount > 0)
    .sort((left, right) => scoreCandidate(right) - scoreCandidate(left) || left.path.localeCompare(right.path))
    .slice(0, maxCandidates)

  return {
    schemaVersion: 'context-planning-pack.v1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary: {
      files: inventory.summary.files,
      routed: inventory.summary.routed,
      inventoryOnly: inventory.summary.inventoryOnly,
      unsupported: inventory.summary.unsupported,
      skipped: inventory.summary.skipped
    },
    budget: { maxCandidates, maxRepresentativeFiles },
    candidates,
    uncertaintyHotspots: candidates
      .filter((candidate) => candidate.uncertainty !== 'low')
      .map((candidate) => ({
        path: candidate.path,
        reason: `Mixed routes/extensions: ${Object.keys(candidate.routeCounts).join(', ')}`,
        confidence: candidate.uncertainty === 'high' ? 0.35 : 0.6
      })),
    drillDownTools: ['inspect_source_candidate', 'search_source_inventory', 'get_source_trace']
  }
}

function candidateDirectories(inventory: ContextSourceInventory): string[] {
  const paths = new Set<string>()
  for (const group of inventory.groups ?? []) {
    paths.add(group.path)
  }
  for (const entry of inventory.entries) {
    let current = normalizePath(dirname(entry.path))
    while (current && current !== '.') {
      paths.add(current)
      const next = normalizePath(dirname(current))
      if (next === current) break
      current = next
    }
  }
  return [...paths]
}

function planningCandidate(path: string, inventory: ContextSourceInventory, maxRepresentativeFiles: number): PlanningPackCandidate {
  const entries = inventory.entries.filter((entry) => pathWithin(entry.path, path))
  const routeCounts = countBy(entries.map((entry) => entry.route))
  const extensionCounts = countBy(entries.map((entry) => extname(entry.path).toLowerCase() || '[none]'))
  const markers = markersFor(path, entries)
  return {
    path,
    title: basename(path) || path,
    fileCount: entries.length,
    routeCounts,
    extensionCounts,
    markers,
    representativeFiles: entries
      .sort((left, right) => routeRank(left.route) - routeRank(right.route) || left.path.localeCompare(right.path))
      .slice(0, maxRepresentativeFiles)
      .map((entry) => entry.path),
    uncertainty: uncertaintyFor(routeCounts, extensionCounts, markers)
  }
}

/** Reconcile child-scope evidence into graph patches and proposal-only file rehome suggestions. */
export function reconcileEvidenceReports(graph: ContextGraph, revision: GraphRevision, reports: EvidenceReport[]): ReconcileEvidenceResult {
  const patches: GraphPatch[] = []
  const rehomeProposals: RehomeProposal[] = []
  for (const report of reports) {
    const operations: PatchOperation[] = []
    for (const finding of report.findings) {
      operations.push(...operationsForFinding(graph, report, finding, rehomeProposals))
    }
    const proposedPatches = report.proposedPatches.map((patch) => ({
      ...patch,
      evidenceReportIds: unique([...(patch.evidenceReportIds ?? []), report.id])
    }))
    patches.push(...proposedPatches)
    if (operations.length > 0) {
      patches.push(
        {
          schemaVersion: 'context-graph-patch.v1',
          id: `PATCH-${slug(report.id)}`,
          revisionId: revision.id,
          author: { type: 'kernel', name: 'graph-kernel' },
          status: 'proposed',
          createdAt: report.generatedAt,
          evidence: report.findings.flatMap((finding) => finding.evidence),
          evidenceReportIds: [report.id],
          operations
        }
      )
    }
  }
  return { patches, rehomeProposals }
}

function operationsForFinding(
  graph: ContextGraph,
  report: EvidenceReport,
  finding: EvidenceFinding,
  rehomeProposals: RehomeProposal[]
): PatchOperation[] {
  switch (finding.type) {
    case 'relabel_group':
      return relabelOperations(report, finding)
    case 'misplaced_source':
      return misplacedSourceOperations(report, finding, rehomeProposals)
    case 'split_group':
      return splitGroupOperations(graph, report, finding)
    case 'merge_group':
      return mergeGroupOperations(report, finding)
    case 'link_groups':
      return linkGroupOperations(report, finding)
    case 'confirm_fact':
      return confirmFactOperations(report, finding)
  }
}

function relabelOperations(report: EvidenceReport, finding: EvidenceFinding): PatchOperation[] {
  if (!finding.nodeId || !finding.suggestedKind) {
    return []
  }
  return [
    {
      op: 'relabel_source_group',
      nodeId: finding.nodeId,
      kind: finding.suggestedKind,
      summary: report.summary,
      confidence: finding.confidence
    }
  ]
}

function misplacedSourceOperations(report: EvidenceReport, finding: EvidenceFinding, rehomeProposals: RehomeProposal[]): PatchOperation[] {
  const operations: PatchOperation[] = []
  operations.push(...relabelOperations(report, finding))
  if (finding.targetGroupId) {
    for (const nodeId of finding.affectedNodeIds ?? []) {
      operations.push({ op: 'reparent_node', nodeId, sourceGroupId: finding.targetGroupId })
    }
  }
  if (finding.sourcePath) {
    const proposal: RehomeProposal = {
      schemaVersion: 'context-rehome-proposal.v1',
      id: `REHOME-${slug(`${finding.sourcePath}-${finding.targetGroupId ?? ''}-${finding.suggestedPath ?? 'keep'}`)}`,
      sourcePath: finding.sourcePath,
      fromGroupId: finding.nodeId,
      toGroupId: finding.targetGroupId,
      suggestedPath: finding.suggestedPath,
      action: 'keep',
      reason: report.summary,
      confidence: finding.confidence,
      evidence: finding.evidence,
      status: 'proposed',
      createdAt: report.generatedAt
    }
    rehomeProposals.push(proposal)
    operations.push({ op: 'rehome_proposal', proposal })
  }
  return operations
}

function splitGroupOperations(graph: ContextGraph, report: EvidenceReport, finding: EvidenceFinding): PatchOperation[] {
  if (!finding.nodeId || !finding.newGroup) {
    return []
  }
  const targetGroupId = finding.targetGroupId ?? finding.newGroup.id ?? `SOURCE-GROUP-${slug(finding.newGroup.path)}`
  const operations: PatchOperation[] = []
  if (!graph.nodes.some((node) => node.id === targetGroupId)) {
    const evidenceSourceRefs = sourceRefsForEvidence(finding.evidence)
    operations.push({
      op: 'add_node',
      node: createContextNode({
        id: targetGroupId,
        type: 'SourceGroup',
        name: finding.newGroup.title,
        status: 'hypothesis',
        authority: 'inferred',
        confidence: finding.newGroup.confidence ?? finding.confidence,
        sourceRefs: evidenceSourceRefs,
        properties: {
          kind: finding.newGroup.kind,
          path: finding.newGroup.path,
          boundaryMode: finding.newGroup.boundaryMode,
          summary: finding.newGroup.summary,
          childrenPolicy: finding.newGroup.childrenPolicy,
          decisionSource: 'evidence',
          evidenceReportId: report.id,
          revisionId: report.revisionId
        }
      })
    })
  }
  if (!graph.edges.some((edge) => edge.from === finding.nodeId && edge.to === targetGroupId && edge.type === 'contains_group')) {
    operations.push({
      op: 'add_edge',
      edge: createContextEdge({
        from: finding.nodeId,
        to: targetGroupId,
        type: 'contains_group',
        linker: 'graph-kernel',
        status: 'inferred',
        confidence: finding.confidence,
        evidence: finding.evidence,
        properties: { evidenceReportId: report.id }
      })
    })
  }
  for (const nodeId of finding.affectedNodeIds ?? []) {
    operations.push({ op: 'reparent_node', nodeId, sourceGroupId: targetGroupId })
  }
  return operations
}

function mergeGroupOperations(report: EvidenceReport, finding: EvidenceFinding): PatchOperation[] {
  if (!finding.nodeId || !finding.targetGroupId) {
    return []
  }
  return [
    {
      op: 'deprecate_node',
      nodeId: finding.nodeId,
      supersededBy: finding.targetGroupId,
      reason: report.summary
    },
    ...((finding.affectedNodeIds ?? []).map((nodeId) => ({ op: 'reparent_node', nodeId, sourceGroupId: finding.targetGroupId }) as PatchOperation))
  ]
}

function linkGroupOperations(report: EvidenceReport, finding: EvidenceFinding): PatchOperation[] {
  if (!finding.nodeId || !finding.targetGroupId) {
    return []
  }
  return [
    {
      op: 'link',
      edge: createContextEdge({
        from: finding.nodeId,
        to: finding.targetGroupId,
        type: finding.relationType ?? 'related_to_group',
        linker: 'graph-kernel',
        status: 'inferred',
        confidence: finding.confidence,
        evidence: finding.evidence,
        properties: { evidenceReportId: report.id }
      })
    }
  ]
}

function confirmFactOperations(report: EvidenceReport, finding: EvidenceFinding): PatchOperation[] {
  if (!finding.nodeId) {
    return []
  }
  return [
    {
      op: 'update_node',
      nodeId: finding.nodeId,
      status: 'confirmed',
      confidence: finding.confidence,
      properties: {
        evidenceReportId: report.id,
        confirmedBy: 'evidence-report'
      }
    }
  ]
}

function sourceRefsForEvidence(evidence: Evidence[]): SourceRef[] {
  const sourceRefs = new Map<string, SourceRef>()
  for (const item of evidence) {
    for (const sourceRef of item.sourceRefs) {
      sourceRefs.set(`${sourceRef.sourceId}:${sourceRef.uri}:${sourceRef.location?.path ?? ''}`, sourceRef)
    }
  }
  return [...sourceRefs.values()]
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const without = items.filter((candidate) => candidate.id !== item.id)
  return [...without, item]
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

function markersFor(path: string, entries: ContextSourceInventory['entries']): string[] {
  const markers = new Set<string>()
  const normalized = path.toLowerCase()
  if (normalized.includes('src') || entries.some((entry) => basename(entry.path) === 'package.json')) markers.add('repository')
  if (normalized.includes('doc') || entries.some((entry) => entry.route === 'markdown')) markers.add('document')
  if (normalized.includes('api') || entries.some((entry) => entry.route === 'openapi')) markers.add('api')
  if (normalized.includes('analysis') || normalized.includes('report')) markers.add('analysis')
  if (entries.some((entry) => entry.status === 'unsupported')) markers.add('needs-adapter')
  return [...markers].sort()
}

function uncertaintyFor(routeCounts: Record<string, number>, extensionCounts: Record<string, number>, markers: string[]): PlanningPackCandidate['uncertainty'] {
  const routeKinds = Object.keys(routeCounts).length
  const extensionKinds = Object.keys(extensionCounts).length
  if (routeKinds > 3 || extensionKinds > 8 || markers.includes('needs-adapter')) return 'high'
  if (routeKinds > 1 || extensionKinds > 3) return 'medium'
  return 'low'
}

function scoreCandidate(candidate: PlanningPackCandidate): number {
  return candidate.fileCount + candidate.markers.length * 5 + (candidate.uncertainty === 'high' ? 4 : candidate.uncertainty === 'medium' ? 2 : 0)
}

function byPatchOrder(left: GraphPatch, right: GraphPatch): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function patchDiagnostic(code: string, patchId: string, message: string, nodeId?: string): Diagnostic {
  return createDiagnostic({
    severity: 'error',
    code,
    message,
    nodeId,
    metadata: { patchId }
  })
}

function routeRank(route: string): number {
  if (route === 'markdown') return 0
  if (route === 'openapi') return 1
  if (route === 'code') return 2
  if (route === 'inventory') return 3
  return 4
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}
