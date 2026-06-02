import type { ContextProjectConfig } from './config.js'
import { dedupeNodes } from './graph.js'
import { filterNodesForRole } from './role-view.js'
import type { ContextEdge, ContextGraph, ContextNode, Diagnostic } from './schemas.js'

export interface TaskContextRequest {
  task: string
  role: string
  maxTokens?: number
}

export interface TaskContextResult {
  task: string
  role: string
  project: string
  matchedNodes: ContextNode[]
  nodes: ContextNode[]
  edges: ContextEdge[]
  diagnostics: Diagnostic[]
  recommendedChecks: string[]
  outputSlug: string
}

const STRUCTURAL_EDGE_TYPES = new Set(['has_acceptance_criteria', 'relates_to', 'verified_by'])

export function generateTaskContext(
  graph: ContextGraph,
  config: ContextProjectConfig,
  request: TaskContextRequest
): TaskContextResult {
  const roleNodes = filterNodesForRole(graph, config, request.role)
  const roleNodeIds = new Set(roleNodes.map((node) => node.id))
  const matchedNodes = roleNodes.filter((node) => nodeMatchesTask(node, request.task))
  const expandedIds = new Set(matchedNodes.map((node) => node.id))

  for (const edge of graph.edges) {
    if (!STRUCTURAL_EDGE_TYPES.has(edge.type)) {
      continue
    }
    if (expandedIds.has(edge.from)) {
      expandedIds.add(edge.to)
    }
    if (expandedIds.has(edge.to)) {
      expandedIds.add(edge.from)
    }
  }

  const nodes = dedupeNodes(
    graph.nodes.filter((node) => expandedIds.has(node.id) && roleNodeIds.has(node.id))
  )
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  const diagnostics = graph.diagnostics.filter(
    (diagnostic) => diagnostic.nodeId && nodeIds.has(diagnostic.nodeId)
  )

  return {
    task: request.task,
    role: request.role,
    project: config.project.name,
    matchedNodes,
    nodes,
    edges,
    diagnostics,
    recommendedChecks: recommendedChecksFor(nodes, diagnostics),
    outputSlug: taskSlug(request.task, matchedNodes)
  }
}

export function renderTaskContextMarkdown(result: TaskContextResult): string {
  const lines = [
    `# Task Context: ${result.task}`,
    '',
    `Role: ${result.role}`,
    `Project: ${result.project}`,
    ''
  ]

  if (result.nodes.length === 0) {
    lines.push('No directly related context found.', '')
    return lines.join('\n')
  }

  appendSection(lines, 'Requirements', result.nodes, 'requirement')
  appendSection(lines, 'Business Rules', result.nodes, 'business_rule')
  appendSection(lines, 'Acceptance Criteria', result.nodes, 'acceptance_criteria')
  appendSection(lines, 'APIs', result.nodes, 'api_contract')
  appendSection(lines, 'Code Symbols', result.nodes, 'code_symbol')
  appendSection(lines, 'Test Cases', result.nodes, 'test_case')
  appendSection(lines, 'Bugs', result.nodes, 'bug')
  appendDiagnostics(lines, result.diagnostics)

  if (result.recommendedChecks.length > 0) {
    lines.push('## Recommended Checks', '')
    for (const check of result.recommendedChecks) {
      lines.push(`- ${check}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

function appendSection(
  lines: string[],
  title: string,
  nodes: ContextNode[],
  type: ContextNode['type']
): void {
  const selected = nodes.filter((node) => node.type === type)
  if (selected.length === 0) {
    return
  }

  lines.push(`## ${title}`, '')
  for (const node of selected) {
    lines.push(`- ${node.id}: ${node.title}`)
    if (node.source?.uri) {
      lines.push(`  Source: ${node.source.uri}`)
    }
  }
  lines.push('')
}

function appendDiagnostics(lines: string[], diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    return
  }

  lines.push('## Diagnostics', '')
  for (const diagnostic of diagnostics) {
    lines.push(`- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
  }
  lines.push('')
}

function nodeMatchesTask(node: ContextNode, task: string): boolean {
  const haystack = searchableText(node)
  const normalizedTask = normalize(task)
  if (normalizedTask.length > 0 && haystack.includes(normalizedTask)) {
    return true
  }

  const tokens = taskTokens(task)
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token))
}

function searchableText(node: ContextNode): string {
  return normalize(
    [
      node.id,
      node.title,
      node.content,
      ...node.tags,
      ...Object.values(node.metadata).flatMap((value) => metadataText(value))
    ].join(' ')
  )
}

function metadataText(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }
  if (Array.isArray(value)) {
    return value.flatMap(metadataText)
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(metadataText)
  }
  return []
}

function taskTokens(task: string): string[] {
  const asciiTokens = normalize(task)
    .split(/[^a-z0-9/{}.-]+/)
    .filter((token) => token.length >= 2)
  if (asciiTokens.length > 0) {
    return asciiTokens
  }

  return normalize(task)
    .split('')
    .filter((char) => /\p{Letter}|\p{Number}/u.test(char))
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function recommendedChecksFor(nodes: ContextNode[], diagnostics: Diagnostic[]): string[] {
  if (nodes.length === 0) {
    return []
  }

  const checks = [
    'Review linked requirements, APIs, code symbols, tests, and diagnostics before implementation.'
  ]
  if (nodes.some((node) => node.type === 'test_case')) {
    checks.push('Run or add tests covering the related requirements before shipping changes.')
  }
  if (diagnostics.length > 0) {
    checks.push('Resolve or consciously accept the listed diagnostics before handoff.')
  }
  return checks
}

function taskSlug(task: string, matchedNodes: ContextNode[]): string {
  const ascii = slug(task)
  if (ascii.length > 0) {
    return ascii
  }

  const translated = translateCommonChineseTaskWords(task)
  if (translated.length > 0) {
    return translated
  }

  const fallback = matchedNodes[0]?.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return fallback && fallback.length > 0 ? fallback : 'task-context'
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function translateCommonChineseTaskWords(task: string): string {
  const parts = []
  if (task.includes('支持')) {
    parts.push('support')
  }
  if (task.includes('部分')) {
    parts.push('partial')
  }
  if (task.includes('退款')) {
    parts.push('refund')
  }
  if (task.includes('测试')) {
    parts.push('test')
  }
  if (task.includes('回归')) {
    parts.push('regression')
  }
  return parts.join('-')
}

