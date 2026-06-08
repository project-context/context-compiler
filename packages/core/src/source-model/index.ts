import { basename, relative, resolve } from 'node:path'
import type {
  ContextEdge,
  ContextGraph,
  ContextGraphAdapterRef,
  ContextNode,
  ContextPackageKind,
  ContextPackageRecord,
  ContextSourceCorrectionDecision,
  ContextSourceGroupKind,
  ContextSourceGroupRecord,
  ContextSourceGroupingDecision,
  ContextSourceGroupBoundaryMode,
  SourceConfig,
  SourceRef
} from '../contracts/index.js'
import { createContextEdge, createContextNode, slug } from '../graph/model.js'
import { scopeDirName, scopeIdForPackage, scopeIdForSourceGroup } from '../graph/scopes.js'

export * from '../planning/source-first.js'

export interface GroupingDecisionToSourceGroupRecordOptions {
  source: SourceConfig
  rootDir: string
  decision: ContextSourceGroupingDecision
  decisionSource: ContextSourceGroupRecord['decisionSource']
}

export interface ApplySourceCorrectionDecisionsOptions {
  groups: ContextSourceGroupRecord[]
  decisions: ContextSourceCorrectionDecision[]
  sourceRootPath: string
  source: SourceConfig
  rootDir: string
}

export interface SourceRootNodeOptions {
  source: SourceConfig
  rootDir: string
  sourcePath: string
  configuredPath: string
}

export interface BuildSourceModelSeedGraphOptions {
  sourceNode: ContextNode
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
}

/** Convert source grouping decisions into canonical L1 source group records. */
export function groupingDecisionToSourceGroupRecord(options: GroupingDecisionToSourceGroupRecordOptions): ContextSourceGroupRecord {
  const path = decisionPath(options.decision)
  return {
    id: `SOURCE-GROUP-${slug(`${options.source.name}-${path}`)}`,
    sourceName: options.source.name,
    path,
    title: options.decision.title,
    kind: correctedSourceGroupKind(options.decision.kind, 'unknown'),
    boundaryMode: correctedBoundaryMode(options.decision.boundaryMode, 'collapsed'),
    summary: options.decision.summary,
    childrenPolicy: options.decision.childrenPolicy,
    confidence: options.decision.confidence,
    decisionSource: options.decisionSource,
    sourceRef: sourceRefFor(options.source.name, options.rootDir, resolve(options.rootDir, path), path)
  }
}

/** Build the default fallback grouping decision for material that could not be classified. */
export function buildInferredUnknownGroupingDecision(sourceRootPath: string): ContextSourceGroupingDecision {
  return {
    path: sourceRootPath,
    kind: 'unknown',
    boundaryMode: 'collapsed',
    title: '未知资料包',
    summary: 'Source materials could not be confidently classified, so they are preserved as an inventory-only unknown package.',
    childrenPolicy: 'promote_routed',
    confidence: 0.35
  }
}

/** Build L0 package records from top-level L1 source groups. */
export function buildL0Packages(sourceName: string, groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  const topLevelGroups = groups.filter((group) => !parentGroupFor(group, groups))
  return topLevelGroups.map((group) => {
    const kind = packageKindForSourceGroupKind(group.kind)
    const sourceGroupIds = groups.filter((candidate) => pathWithin(candidate.path, group.path)).map((candidate) => candidate.id).sort()
    const buildUnitKind = buildUnitKindForSourceGroupKind(group.kind)
    const standardKind = standardBuildUnitKindForSourceGroupKind(group.kind)
    const adapterSelection = adapterSelectionForSourceGroupKind(group.kind)
    return {
      id: packageIdForGroup(group),
      sourceName,
      path: group.path,
      title: `${packageKindLabel(kind)}: ${group.title}`,
      kind,
      summary: group.summary,
      sourceGroupIds,
      buildUnits: [
        {
          id: `unit:${slug(`${sourceName}:${group.path}:${buildUnitKind}`)}`,
          kind: buildUnitKind,
          standardKind,
          title: group.title,
          sourceGroupIds,
          adapterId: adapterSelection.adapterId,
          adapterSelection,
          path: group.path,
          summary: group.summary
        }
      ],
      confidence: group.confidence,
      decisionSource: group.decisionSource,
      sourceRef: group.sourceRef,
      metadata: {
        sourceGroupKind: group.kind,
        boundaryMode: group.boundaryMode,
        correctionDecisionIds: Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds : undefined
      }
    }
  })
}

/** Create the canonical source root node for a configured source boundary. */
export function sourceRootNode(options: SourceRootNodeOptions): ContextNode {
  const rootSourceRef = sourceRefFor(options.source.name, options.rootDir, options.sourcePath, options.configuredPath)
  return createContextNode({
    id: `SOURCE-${slug(options.source.name)}`,
    type: 'Source',
    name: options.source.name,
    sourceRefs: [rootSourceRef],
    properties: {
      path: options.source.path,
      type: options.source.type ?? 'auto',
      parser: options.source.parser,
      mediaType: options.source.mediaType
    }
  })
}

/** Materialize source root, L0 package, and L1 source group facts and structural edges. */
export function buildSourceModelSeedGraph(options: BuildSourceModelSeedGraphOptions): ContextGraph {
  const nodes = [
    options.sourceNode,
    ...options.packages.map((record) => l0PackageNode(record)),
    ...options.groups.map((group) => sourceGroupNode(group))
  ].sort(byId)
  const edges: ContextEdge[] = []

  for (const record of options.packages) {
    const packageScopeId = scopeIdForPackage(record.id)
    edges.push(
      createContextEdge({
        id: `EDGE-${options.sourceNode.id}-contains-package-${record.id}`,
        from: options.sourceNode.id,
        to: record.id,
        type: 'contains_package',
        linker: 'source-model',
        status: 'confirmed',
        evidence: []
      })
    )
    edges.push(
      createContextEdge({
        id: `EDGE-${record.id}-materializes-subgraph-${slug(packageScopeId)}`,
        from: record.id,
        to: record.id,
        type: 'materializes_subgraph',
        linker: 'source-model',
        status: 'confirmed',
        evidence: [],
        properties: {
          scopeId: packageScopeId,
          subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`
        }
      })
    )
    for (const groupId of record.sourceGroupIds) {
      edges.push(
        createContextEdge({
          id: `EDGE-${record.id}-contains-source-group-${groupId}`,
          from: record.id,
          to: groupId,
          type: 'contains_source_group',
          linker: 'source-model',
          status: 'confirmed',
          evidence: []
        })
      )
    }
  }

  for (const group of options.groups) {
    const scopeId = scopeIdForSourceGroup(group.id)
    edges.push(
      createContextEdge({
        id: `EDGE-${group.id}-materializes-subgraph-${slug(scopeId)}`,
        from: group.id,
        to: group.id,
        type: 'materializes_subgraph',
        linker: 'source-model',
        status: 'confirmed',
        evidence: [],
        properties: {
          scopeId,
          subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`
        }
      })
    )
  }

  for (const group of options.groups) {
    const parent = parentGroupFor(group, options.groups)
    if (!parent) {
      continue
    }
    edges.push(
      createContextEdge({
        id: `EDGE-${parent.id}-has-child-scope-${group.id}`,
        from: parent.id,
        to: group.id,
        type: 'has_child_scope',
        linker: 'source-model',
        status: 'confirmed',
        evidence: [],
        properties: {
          parentScopeId: scopeIdForSourceGroup(parent.id),
          childScopeId: scopeIdForSourceGroup(group.id)
        }
      })
    )
  }

  return {
    nodes,
    edges: edges.sort(byId),
    diagnostics: []
  }
}

/** Apply active source correction decisions to source groups before package materialization. */
export function applySourceCorrectionDecisions(options: ApplySourceCorrectionDecisionsOptions): ContextSourceGroupRecord[] {
  if (options.decisions.length === 0) {
    return options.groups
  }
  const applicable = effectiveSourceCorrectionDecisionRows(options.decisions)
    .filter((decision) => decision.status === 'applied')
    .filter((decision) => sourceCorrectionWithinRoot(decision, options.sourceRootPath))
  if (applicable.length === 0) {
    return options.groups
  }
  const byId = new Map(options.groups.map((group) => [group.id, group]))
  const next = options.groups.map((group) => {
    let current = group
    const groupDecisions = applicable.filter((decision) => correctionAppliesToGroup(decision, current))
    for (const decision of groupDecisions) {
      current = applySourceCorrectionDecisionToGroup(current, decision)
    }
    byId.set(current.id, current)
    return current
  })

  for (const decision of applicable.filter((candidate) => candidate.kind === 'split')) {
    const targetId = decision.sourceGroupId
    const after = decision.after
    const path = stringRecordValue(after, 'path') ?? decision.sourcePath
    if (!targetId || !path || byId.has(targetId)) {
      continue
    }
    const kind = correctedSourceGroupKind(stringRecordValue(after, 'kind'), 'unknown')
    const group: ContextSourceGroupRecord = {
      id: targetId,
      sourceName: options.source.name,
      path,
      title: stringRecordValue(after, 'title') ?? basename(path),
      kind,
      boundaryMode: correctedBoundaryMode(stringRecordValue(after, 'boundaryMode'), kind === 'repository' ? 'repository' : 'collapsed'),
      summary: stringRecordValue(after, 'summary') ?? `Source group created by correction ${decision.id}.`,
      confidence: numberRecordValue(after, 'confidence') ?? 0.7,
      decisionSource: 'agent',
      sourceRef: sourceRefFor(options.source.name, options.rootDir, resolve(options.rootDir, path), path),
      metadata: { correctionDecisionIds: [decision.id] }
    }
    byId.set(group.id, group)
    next.push(group)
  }
  return next.sort((left, right) => left.path.localeCompare(right.path))
}

/** Collapse raw JSONL events into latest rows and supersede older applied rows per dedupe key. */
export function effectiveSourceCorrectionDecisionRows(decisions: ContextSourceCorrectionDecision[]): ContextSourceCorrectionDecision[] {
  const latestById = latestDecisionById(decisions)
  const groups = new Map<string, ContextSourceCorrectionDecision[]>()
  for (const decision of latestById) {
    const key = decision.dedupeKey ?? decisionDedupeKey(decision)
    groups.set(key, [...(groups.get(key) ?? []), { ...decision, dedupeKey: key }])
  }
  const result: ContextSourceCorrectionDecision[] = []
  for (const group of groups.values()) {
    const ordered = group.sort((left, right) => decisionTime(left).localeCompare(decisionTime(right)) || left.id.localeCompare(right.id))
    const latestApplied = [...ordered].reverse().find((decision) => decision.status === 'applied')
    for (const decision of ordered) {
      if (latestApplied && decision.id !== latestApplied.id && decision.status === 'applied') {
        result.push({
          ...decision,
          status: 'superseded',
          supersededByDecisionId: latestApplied.id
        })
      } else if (latestApplied && decision.id === latestApplied.id) {
        result.push({
          ...decision,
          supersedesDecisionIds: ordered.filter((candidate) => candidate.id !== decision.id && candidate.status === 'applied').map((candidate) => candidate.id)
        })
      } else {
        result.push(decision)
      }
    }
  }
  return result.sort((left, right) => decisionTime(left).localeCompare(decisionTime(right)) || left.id.localeCompare(right.id))
}

export function sourceRefFor(sourceName: string, rootDir: string, file: string, path: string): SourceRef {
  const relativePath = normalizePath(relative(rootDir, file))
  return {
    sourceId: `${sourceName}:${slug(relativePath)}`,
    uri: `file://${relativePath}`,
    title: sourceName,
    location: {
      path: normalizePath(path)
    }
  }
}

export function decisionPath(decision: Pick<ContextSourceGroupingDecision, 'path'>): string {
  return normalizeConfiguredPath(decision.path)
}

export function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizeConfiguredPath(path)
  const normalizedRoot = normalizeConfiguredPath(rootPath)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function l0PackageNode(record: ContextPackageRecord): ContextNode {
  const packageScopeId = scopeIdForPackage(record.id)
  return createContextNode({
    id: record.id,
    type: 'Package',
    name: record.title,
    status: 'hypothesis',
    scopeId: 'scope:project',
    subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`,
    sourceRefs: [record.sourceRef],
    confidence: record.confidence,
    properties: {
      packageKind: record.kind,
      path: record.path,
      summary: record.summary,
      sourceGroupIds: record.sourceGroupIds,
      buildUnits: record.buildUnits,
      confidence: record.confidence,
      decisionSource: record.decisionSource,
      sourceName: record.sourceName,
      scopeId: packageScopeId,
      subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`
    }
  })
}

function sourceGroupNode(group: ContextSourceGroupRecord): ContextNode {
  const scopeId = scopeIdForSourceGroup(group.id)
  return createContextNode({
    id: group.id,
    type: 'SourceGroup',
    name: group.title,
    status: 'hypothesis',
    scopeId: 'scope:project',
    subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`,
    sourceRefs: [group.sourceRef],
    confidence: group.confidence,
    properties: {
      kind: group.kind,
      path: group.path,
      boundaryMode: group.boundaryMode,
      summary: group.summary,
      childrenPolicy: group.childrenPolicy,
      confidence: group.confidence,
      decisionSource: group.decisionSource,
      sourceName: group.sourceName,
      scopeId,
      subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`
    }
  })
}

function packageIdForGroup(group: ContextSourceGroupRecord): string {
  return `PACKAGE-${slug(`${group.sourceName}-${group.path}`)}`
}

function packageKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageKind {
  switch (kind) {
    case 'repository':
    case 'test_bundle':
      return 'code_repository'
    case 'doc_bundle':
    case 'domain_area':
    case 'api_bundle':
    case 'config_bundle':
      return 'product_docs'
    case 'analysis_bundle':
      return 'analysis'
    case 'design_bundle':
      return 'design'
    case 'data_bundle':
      return 'data'
    case 'runtime_bundle':
      return 'runtime'
    case 'asset_bundle':
      return 'asset'
    default:
      return 'unknown'
  }
}

function packageKindLabel(kind: ContextPackageKind): string {
  switch (kind) {
    case 'product_docs':
      return '产品资料包'
    case 'code_repository':
      return '代码仓库包'
    case 'analysis':
      return '分析资料包'
    case 'design':
      return '设计资料包'
    case 'data':
      return '数据资料包'
    case 'runtime':
      return '运行时资料包'
    case 'asset':
      return '资产包'
    default:
      return '未知包'
  }
}

function buildUnitKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageRecord['buildUnits'][number]['kind'] {
  if (kind === 'repository' || kind === 'test_bundle') return 'repository'
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area') return 'graphrag_corpus'
  if (kind === 'api_bundle') return 'api_contracts'
  return 'inventory'
}

function standardBuildUnitKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageRecord['buildUnits'][number]['standardKind'] {
  if (kind === 'repository' || kind === 'test_bundle') return 'repository'
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area') return 'semantic_corpus'
  if (kind === 'api_bundle') return 'api_contracts'
  return 'inventory'
}

function adapterSelectionForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextGraphAdapterRef {
  switch (kind) {
    case 'repository':
    case 'test_bundle':
      return selectedAdapter('codegraph.graph-adapter', 'code-graph-builder', `Default code graph adapter for ${kind} source groups.`, [
        'tree-sitter',
        'codegraph.graph-adapter'
      ])
    case 'doc_bundle':
    case 'analysis_bundle':
    case 'domain_area':
      return selectedAdapter('microsoft-graphrag.graph-adapter', 'semantic-graph-builder', `Default semantic corpus adapter for ${kind} source groups.`, [
        'microsoft-graphrag.graph-adapter',
        'builtin.markdown-text'
      ])
    case 'api_bundle':
      return selectedAdapter('builtin.openapi', 'semantic-graph-builder', 'Default API contract adapter for api_bundle source groups.', [
        'builtin.openapi'
      ])
    default:
      return selectedAdapter('builtin.source-inventory', 'inventory', `Default inventory-only adapter for ${kind} source groups.`, [
        'builtin.source-inventory'
      ])
  }
}

function selectedAdapter(
  adapterId: string,
  role: ContextGraphAdapterRef['role'],
  selectionReason: string,
  candidateAdapterIds: string[]
): ContextGraphAdapterRef {
  return {
    adapterId,
    role,
    selectionSource: 'default',
    selectionReason,
    priority: 0,
    candidateAdapterIds
  }
}

function parentGroupFor(group: ContextSourceGroupRecord, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups
    .filter((candidate) => candidate.id !== group.id && pathWithin(group.path, candidate.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function applySourceCorrectionDecisionToGroup(
  group: ContextSourceGroupRecord,
  decision: ContextSourceCorrectionDecision
): ContextSourceGroupRecord {
  const decisionIds = [...new Set([...(Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds.filter((id): id is string => typeof id === 'string') : []), decision.id])]
  const metadata = { ...(group.metadata ?? {}), correctionDecisionIds: decisionIds }
  if (decision.kind === 'relabel') {
    return {
      ...group,
      title: stringRecordValue(decision.after, 'title') ?? group.title,
      kind: correctedSourceGroupKind(stringRecordValue(decision.after, 'kind'), group.kind),
      boundaryMode: correctedBoundaryMode(stringRecordValue(decision.after, 'boundaryMode'), group.boundaryMode),
      summary: stringRecordValue(decision.after, 'summary') ?? group.summary,
      confidence: numberRecordValue(decision.after, 'confidence') ?? group.confidence,
      metadata
    }
  }
  if (decision.kind === 'merge') {
    return {
      ...group,
      metadata: {
        ...metadata,
        mergedIntoGroupId: decision.targetGroupId,
        mergedIntoPath: decision.targetPath
      }
    }
  }
  if (decision.kind === 'rehome') {
    return {
      ...group,
      metadata: {
        ...metadata,
        rehomeTargetGroupId: decision.targetGroupId,
        rehomeTargetPath: decision.targetPath
      }
    }
  }
  return { ...group, metadata }
}

function sourceCorrectionWithinRoot(decision: ContextSourceCorrectionDecision, sourceRootPath: string): boolean {
  return [decision.sourcePath, decision.targetPath]
    .filter((path): path is string => typeof path === 'string')
    .some((path) => pathWithin(path, sourceRootPath) || pathWithin(sourceRootPath, path))
}

function correctionAppliesToGroup(decision: ContextSourceCorrectionDecision, group: ContextSourceGroupRecord): boolean {
  return decision.sourceGroupId === group.id || decision.targetGroupId === group.id || Boolean(decision.sourcePath && pathWithin(decision.sourcePath, group.path)) || Boolean(decision.targetPath && pathWithin(decision.targetPath, group.path))
}

function correctedSourceGroupKind(value: string | undefined, fallback: ContextSourceGroupKind): ContextSourceGroupKind {
  const allowed = new Set<ContextSourceGroupKind>([
    'repository',
    'doc_bundle',
    'asset_bundle',
    'analysis_bundle',
    'domain_area',
    'data_bundle',
    'api_bundle',
    'design_bundle',
    'test_bundle',
    'config_bundle',
    'runtime_bundle',
    'vendor_bundle',
    'generated_bundle',
    'archive',
    'unknown'
  ])
  return value && allowed.has(value as ContextSourceGroupKind) ? value as ContextSourceGroupKind : fallback
}

function correctedBoundaryMode(value: string | undefined, fallback: ContextSourceGroupBoundaryMode): ContextSourceGroupBoundaryMode {
  return value === 'expanded' || value === 'collapsed' || value === 'repository' ? value : fallback
}

function stringRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function numberRecordValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function latestDecisionById(decisions: ContextSourceCorrectionDecision[]): ContextSourceCorrectionDecision[] {
  const byId = new Map<string, ContextSourceCorrectionDecision>()
  for (const decision of decisions) {
    const existing = byId.get(decision.id)
    if (!existing || decisionTime(existing) <= decisionTime(decision)) {
      byId.set(decision.id, decision)
    }
  }
  return [...byId.values()]
}

function decisionDedupeKey(decision: ContextSourceCorrectionDecision): string {
  return [
    decision.kind,
    decision.packageId,
    decision.sourceGroupId,
    decision.targetGroupId,
    decision.sourcePath,
    decision.targetPath
  ].filter(Boolean).join(':')
}

function decisionTime(decision: ContextSourceCorrectionDecision): string {
  return decision.updatedAt ?? decision.createdAt
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function normalizeConfiguredPath(value: string): string {
  return normalizePath(value).replace(/^\.\/+/, '').replace(/\/+$/, '')
}
