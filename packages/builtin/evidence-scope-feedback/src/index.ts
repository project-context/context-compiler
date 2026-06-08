import {
  createGraphRevision,
  defineComponent,
  evidenceFromSource,
  nodeContent,
  nodeStringProperty,
  slug,
  type ContextComponent,
  type ContextGraph,
  type ContextNode,
  type Evidence,
  type EvidenceReport
} from '@context-compiler/core'

interface EvidenceProfile {
  group: ContextNode
  terms: Map<string, TermEvidence>
  nodes: ContextNode[]
}

interface TermEvidence {
  token: string
  labels: string[]
  sourceRefs: ContextNode['sourceRefs']
}

const SYNONYMS = [
  { labels: ['上传'], tokens: ['upload', 'file'] },
  { labels: ['医院'], tokens: ['hospital', 'hos'] },
  { labels: ['保险', '保司'], tokens: ['insurance'] },
  { labels: ['权益'], tokens: ['benefit'] },
  { labels: ['用户'], tokens: ['user'] },
  { labels: ['配置'], tokens: ['config'] },
  { labels: ['理赔'], tokens: ['claim'] }
]

const MIN_GROUP_MATCH_TERMS = 2

/** Create conservative scope feedback reports for parent-graph reconciliation. */
export function createScopeFeedbackEvidenceComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'evidence.scope-feedback',
      stage: 'link',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph'],
      outputs: ['evidence-report'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const reports = buildScopeFeedbackEvidenceReports(state.graph)
      if (reports.length === 0) {
        return {}
      }
      return {
        artifacts: {
          evidenceReports: mergeById([...(isEvidenceReports(state.artifacts.evidenceReports) ? state.artifacts.evidenceReports : []), ...reports])
        }
      }
    }
  })
}

export function buildScopeFeedbackEvidenceReports(graph: ContextGraph): EvidenceReport[] {
  const findings: EvidenceReport['findings'] = []
  const revision = createGraphRevision(graph, { reason: 'materialized compile graph', status: 'materialized' })
  const sourceGroups = graph.nodes.filter((node) => node.type === 'SourceGroup')
  const docProfiles = sourceGroups.map((group) => buildDocProfile(group, graph, sourceGroups)).filter((profile): profile is EvidenceProfile => Boolean(profile))
  const codeProfiles = sourceGroups.map((group) => buildCodeProfile(group, graph, sourceGroups)).filter((profile): profile is EvidenceProfile => Boolean(profile))

  for (const edge of graph.edges.filter((candidate) => candidate.type === 'implemented_by')) {
    const api = graph.nodes.find((node) => node.id === edge.from)
    const symbol = graph.nodes.find((node) => node.id === edge.to)
    if (!api || !symbol || api.type !== 'APIEndpoint' || symbol.type !== 'CodeSymbol') {
      continue
    }
    const apiGroup = sourceGroupForNode(api, sourceGroups)
    const symbolGroup = sourceGroupForNode(symbol, sourceGroups)
    if (!apiGroup || !symbolGroup || apiGroup.id === symbolGroup.id) {
      continue
    }
    const apiKind = nodeStringProperty(apiGroup, 'kind')
    const symbolKind = nodeStringProperty(symbolGroup, 'kind')
    if (!isDocumentLikeGroup(apiKind) || symbolKind !== 'repository') {
      continue
    }
    findings.push({
      type: 'link_groups',
      nodeId: apiGroup.id,
      targetGroupId: symbolGroup.id,
      relationType: 'related_to_group',
      confidence: Math.min(edge.confidence, 0.82),
      evidence: edge.evidence.length > 0
        ? edge.evidence
        : [evidenceFromSource('semantic_match', `API ${api.name} is implemented by ${symbol.name}.`, [...api.sourceRefs, ...symbol.sourceRefs])]
    })
  }

  for (const docProfile of docProfiles) {
    for (const codeProfile of codeProfiles) {
      if (docProfile.group.id === codeProfile.group.id) {
        continue
      }
      const match = profileMatch(docProfile, codeProfile)
      if (match.tokens.length < MIN_GROUP_MATCH_TERMS) {
        continue
      }
      findings.push({
        type: 'link_groups',
        nodeId: docProfile.group.id,
        targetGroupId: codeProfile.group.id,
        relationType: 'related_to_group',
        confidence: Math.min(0.92, 0.58 + match.tokens.length * 0.08),
        evidence: [profileEvidence('semantic_match', match.description, match.sourceRefs)]
      })
      for (const node of docProfile.nodes.filter((candidate) => candidate.type === 'Requirement' || candidate.type === 'Document')) {
        findings.push({
          type: 'confirm_fact',
          nodeId: node.id,
          confidence: 0.86,
          evidence: [profileEvidence('explicit_reference', `Document fact "${node.name}" has source-backed profile evidence: ${match.docLabels.join(', ')}.`, node.sourceRefs)]
        })
      }
    }
  }

  if (findings.length === 0) {
    return []
  }

  return [
    {
      schemaVersion: 'context-evidence-report.v1',
      id: `evidence:scope-feedback:${slug(revision.id)}`,
      revisionId: revision.id,
      scopeId: 'scope:project',
      generatedAt: revision.createdAt,
      summary: 'Scope feedback found weak parent-graph relations from child scope evidence.',
      findings: dedupeFindings(findings),
      proposedPatches: [],
      rehomeProposals: []
    }
  ]
}

function buildDocProfile(group: ContextNode, graph: ContextGraph, sourceGroups: ContextNode[]): EvidenceProfile | undefined {
  const kind = nodeStringProperty(group, 'kind')
  if (!isDocumentLikeGroup(kind)) {
    return undefined
  }
  const nodes = graph.nodes.filter((node) => semanticNodeWithinGroup(node, group, sourceGroups) && (node.type === 'Requirement' || node.type === 'Document' || node.type === 'Section'))
  const terms = new Map<string, TermEvidence>()
  for (const node of nodes) {
    addTerms(terms, [node.name, nodeContent(node), JSON.stringify(node.properties)].join('\n'), node.sourceRefs)
  }
  return terms.size > 0 ? { group, terms, nodes } : undefined
}

function buildCodeProfile(group: ContextNode, graph: ContextGraph, sourceGroups: ContextNode[]): EvidenceProfile | undefined {
  const kind = nodeStringProperty(group, 'kind')
  if (kind !== 'repository') {
    return undefined
  }
  const nodes = graph.nodes.filter((node) => semanticNodeWithinGroup(node, group, sourceGroups) && node.type === 'CodeSymbol')
  const terms = new Map<string, TermEvidence>()
  for (const node of nodes) {
    addTerms(terms, codeProfileText(node), node.sourceRefs)
  }
  return terms.size > 0 ? { group, terms, nodes } : undefined
}

function semanticNodeWithinGroup(node: ContextNode, group: ContextNode, sourceGroups: ContextNode[]): boolean {
  if (node.type === 'Source' || node.type === 'SourceGroup' || node.type === 'SourceSnapshot') {
    return false
  }
  return sourceGroupForNode(node, sourceGroups)?.id === group.id
}

function codeProfileText(node: ContextNode): string {
  return [
    node.name,
    nodeContent(node),
    nodeStringProperty(node, 'file'),
    ...importsText(node),
    ...requestCallText(node)
  ].join('\n')
}

function importsText(node: ContextNode): string[] {
  const imports = node.properties.imports
  if (!Array.isArray(imports)) {
    return []
  }
  return imports.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const record = entry as { module?: unknown; names?: unknown }
    return [typeof record.module === 'string' ? record.module : undefined, ...(Array.isArray(record.names) ? record.names.filter((name): name is string => typeof name === 'string') : [])].filter(
      (value): value is string => typeof value === 'string'
    )
  })
}

function requestCallText(node: ContextNode): string[] {
  const calls = node.properties.requestCalls
  if (!Array.isArray(calls)) {
    return []
  }
  return calls.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }
    const record = entry as { path?: unknown; method?: unknown; prefix?: unknown }
    return [node.name, record.path, record.method, record.prefix].filter((value): value is string => typeof value === 'string')
  })
}

function profileMatch(doc: EvidenceProfile, code: EvidenceProfile): { tokens: string[]; docLabels: string[]; sourceRefs: ContextNode['sourceRefs']; description: string } {
  const tokens = [...doc.terms.keys()].filter((token) => code.terms.has(token)).sort()
  const docLabels = unique(tokens.flatMap((token) => doc.terms.get(token)?.labels ?? [token]))
  const codeLabels = unique(tokens.flatMap((token) => code.terms.get(token)?.labels ?? [token]))
  const codeExamples = code.nodes.slice(0, 5).map((node) => node.name)
  return {
    tokens,
    docLabels,
    sourceRefs: uniqueSourceRefs([...tokens.flatMap((token) => doc.terms.get(token)?.sourceRefs ?? []), ...tokens.flatMap((token) => code.terms.get(token)?.sourceRefs ?? [])]),
    description: `Matched scope profile terms between "${doc.group.name}" and "${code.group.name}": ${docLabels.join(', ')} -> ${codeLabels.join(', ')} via ${codeExamples.join(', ')}.`
  }
}

function addTerms(terms: Map<string, TermEvidence>, text: string, sourceRefs: ContextNode['sourceRefs']): void {
  const normalized = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  for (const token of normalized.split(/[^a-z0-9]+/).filter((part) => part.length >= 2 && !STOP_WORDS.has(part))) {
    addTerm(terms, token, token, sourceRefs)
  }
  for (const synonym of SYNONYMS) {
    if (synonym.labels.some((label) => text.includes(label))) {
      for (const token of synonym.tokens) {
        addTerm(terms, token, synonym.labels[0], sourceRefs)
      }
    }
    if (synonym.tokens.some((token) => normalized.includes(token))) {
      for (const token of synonym.tokens) {
        addTerm(terms, token, token, sourceRefs)
      }
    }
  }
}

function addTerm(terms: Map<string, TermEvidence>, token: string, label: string, sourceRefs: ContextNode['sourceRefs']): void {
  const existing = terms.get(token)
  if (!existing) {
    terms.set(token, { token, labels: [label], sourceRefs })
    return
  }
  existing.labels = unique([...existing.labels, label])
  existing.sourceRefs = uniqueSourceRefs([...existing.sourceRefs, ...sourceRefs])
}

const STOP_WORDS = new Set(['api', 'src', 'tsx', 'ts', 'js', 'index', 'export', 'async', 'function', 'const', 'data', 'any', 'get', 'post', 'content', 'id', 'type'])

function sourceGroupForNode(node: ContextNode, sourceGroups: ContextNode[]): ContextNode | undefined {
  const sourcePaths = node.sourceRefs.map((sourceRef) => sourceRef.location?.path).filter((path): path is string => Boolean(path))
  return sourceGroups
    .filter((group) => {
      const groupPath = nodeStringProperty(group, 'path')
      return typeof groupPath === 'string' && sourcePaths.some((sourcePath) => pathWithin(sourcePath, groupPath))
    })
    .sort((left, right) => (nodeStringProperty(right, 'path')?.length ?? 0) - (nodeStringProperty(left, 'path')?.length ?? 0))
    .at(0)
}

function isDocumentLikeGroup(kind: string | undefined): boolean {
  return kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area'
}

function dedupeFindings(findings: EvidenceReport['findings']): EvidenceReport['findings'] {
  return [...new Map(findings.map((finding) => [`${finding.type}:${finding.nodeId}:${finding.targetGroupId}:${finding.relationType}`, finding])).values()]
}

function profileEvidence(type: Evidence['type'], description: string, sourceRefs: ContextNode['sourceRefs']): Evidence {
  return evidenceFromSource(type, description, uniqueSourceRefs(sourceRefs))
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function mergeById<T extends { id: string }>(records: T[]): T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()]
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function uniqueSourceRefs(sourceRefs: ContextNode['sourceRefs']): ContextNode['sourceRefs'] {
  return [...new Map(sourceRefs.map((sourceRef) => [`${sourceRef.sourceId}:${sourceRef.uri}:${sourceRef.location?.path ?? ''}`, sourceRef])).values()]
}

function isEvidenceReports(value: unknown): value is EvidenceReport[] {
  return Array.isArray(value) && value.every((record) => record && typeof record === 'object' && 'schemaVersion' in record && record.schemaVersion === 'context-evidence-report.v1')
}
