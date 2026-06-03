import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextEdge, ContextGraph, ContextNode, ContextNodeType, ContextProjectConfig, Diagnostic } from '../contracts/index.js'

export type ContextFocus = 'project' | 'implementation' | 'review' | 'testing' | 'product' | 'design'

/** Inferred view definition used to render a stable `.context/views/*.md` file. */
export interface ContextViewDefinition {
  name: string
  title: string
  include: ContextNodeType[] | '*'
  detect?: ContextNodeType[]
  diagnostics?: boolean
}

/** Request used to generate focused context for one task. */
export interface TaskContextRequest {
  task: string
  focus?: ContextFocus | string
  module?: string
  maxTokens?: number
}

/** Generated task context payload before rendering. */
export interface TaskContextResult {
  task: string
  focus?: string
  workspace: string
  matchedNodes: ContextNode[]
  nodes: ContextNode[]
  edges: ContextEdge[]
  diagnostics: Diagnostic[]
  recommendedChecks: string[]
  outputSlug: string
}

const DEFAULT_CONTEXT_VIEWS: ContextViewDefinition[] = [
  {
    name: 'project',
    title: 'Project Context',
    include: [
      'project',
      'domain',
      'repository',
      'module',
      'package',
      'requirement',
      'business_rule',
      'decision',
      'risk',
      'diagnostic'
    ],
    diagnostics: true
  },
  {
    name: 'implementation',
    title: 'Implementation Context',
    include: [
      'requirement',
      'acceptance_criteria',
      'api_contract',
      'route',
      'code_symbol',
      'module',
      'file',
      'config_item',
      'dependency',
      'entry_point',
      'test_case',
      'bug',
      'risk'
    ]
  },
  {
    name: 'review',
    title: 'Review Context',
    include: '*',
    diagnostics: true
  },
  {
    name: 'testing',
    title: 'Testing Context',
    include: ['requirement', 'acceptance_criteria', 'api_contract', 'test_case', 'bug', 'risk', 'code_symbol'],
    diagnostics: true
  },
  {
    name: 'product',
    title: 'Product Context',
    detect: ['requirement', 'business_rule', 'acceptance_criteria', 'decision', 'risk'],
    include: ['requirement', 'business_rule', 'acceptance_criteria', 'decision', 'risk']
  },
  {
    name: 'design',
    title: 'Design Context',
    detect: ['design_spec', 'page', 'ui_component'],
    include: ['requirement', 'design_spec', 'page', 'ui_component', 'acceptance_criteria']
  }
]

const ALWAYS_ON_VIEWS = new Set(['project', 'implementation', 'review', 'testing'])

/** Infer context views from graph contents without asking users to declare roles. */
export function inferContextViews(graph: ContextGraph): ContextViewDefinition[] {
  return DEFAULT_CONTEXT_VIEWS.filter((view) => {
    if (ALWAYS_ON_VIEWS.has(view.name)) {
      return true
    }
    return graph.nodes.some((node) => (view.detect ?? (view.include === '*' ? [] : view.include)).includes(node.type))
  })
}

/** Resolve one inferred context view by name, falling back to a full custom view. */
export function contextViewDefinitionFor(viewName: string): ContextViewDefinition {
  return DEFAULT_CONTEXT_VIEWS.find((view) => view.name === viewName) ?? {
    name: viewName,
    title: `${headline(viewName)} Context`,
    include: '*',
    diagnostics: true
  }
}

/** Filter graph nodes for a context view definition. */
export function filterNodesForContextView(graph: ContextGraph, view: ContextViewDefinition | string): ContextNode[] {
  const definition = typeof view === 'string' ? contextViewDefinitionFor(view) : view
  if (definition.include === '*') {
    return graph.nodes
  }
  return graph.nodes.filter((node) => definition.include.includes(node.type))
}

/** Render a Markdown context view from the compiled graph. */
export function renderContextView(graph: ContextGraph, config: ContextProjectConfig, viewName: string): string {
  const definition = contextViewDefinitionFor(viewName)
  const nodes = filterNodesForContextView(graph, definition)
  const lines = [`# ${definition.title}`, '', `Workspace: ${config.workspace.name}`, '']

  for (const type of [...new Set(nodes.map((node) => node.type))].sort()) {
    const selected = nodes.filter((node) => node.type === type)
    lines.push(`## ${headline(type)}`, '')
    for (const node of selected) {
      lines.push(`- ${node.id}: ${node.title}`)
    }
    lines.push('')
  }

  if (definition.diagnostics && graph.diagnostics.length > 0) {
    lines.push('## Diagnostics', '')
    for (const diagnostic of graph.diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

/** Write Markdown context views inferred from the graph. */
export async function writeContextViews(graph: ContextGraph, outputDir: string, config: ContextProjectConfig): Promise<void> {
  const viewsDir = join(outputDir, 'views')
  await mkdir(viewsDir, { recursive: true })
  await Promise.all(inferContextViews(graph).map((view) => writeFile(join(viewsDir, `${view.name}.md`), renderContextView(graph, config, view.name))))
}

/** Generate task-focused context by matching task text and expanding structural edges. */
export function generateTaskContext(
  graph: ContextGraph,
  config: ContextProjectConfig,
  request: TaskContextRequest
): TaskContextResult {
  const matchedNodes = graph.nodes.filter((node) => nodeMatchesTask(node, request.task) && nodeAllowedByModule(node, request.module, true))
  const expandedIds = new Set(matchedNodes.map((node) => node.id))

  for (const edge of graph.edges) {
    if (!['has_acceptance_criteria', 'relates_to', 'verified_by', 'implemented_by'].includes(edge.type)) {
      continue
    }
    if (expandedIds.has(edge.from)) {
      expandedIds.add(edge.to)
    }
    if (expandedIds.has(edge.to)) {
      expandedIds.add(edge.from)
    }
  }

  const nodes = graph.nodes
    .filter((node) => expandedIds.has(node.id) && nodeAllowedByModule(node, request.module, true))
    .sort((left, right) => nodePriorityForFocus(left, request.focus) - nodePriorityForFocus(right, request.focus))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  const diagnostics = graph.diagnostics.filter((diagnostic) => diagnostic.nodeId && nodeIds.has(diagnostic.nodeId))

  return {
    task: request.task,
    focus: request.focus,
    workspace: config.workspace.name,
    matchedNodes,
    nodes,
    edges,
    diagnostics,
    recommendedChecks: recommendedChecksFor(nodes, diagnostics, request.focus),
    outputSlug: taskSlug(request.task, matchedNodes)
  }
}

/** Render a task context payload as Markdown. */
export function renderTaskContextMarkdown(result: TaskContextResult): string {
  const lines = [`# Task Context: ${result.task}`, '', `Workspace: ${result.workspace}`]
  if (result.focus) {
    lines.push(`Focus: ${result.focus}`)
  }
  lines.push('')
  if (result.nodes.length === 0) {
    lines.push('No directly related context found.', '')
    return lines.join('\n')
  }

  appendSection(lines, 'Requirements', result.nodes, 'requirement')
  appendSection(lines, 'Acceptance Criteria', result.nodes, 'acceptance_criteria')
  appendSection(lines, 'APIs', result.nodes, 'api_contract')
  appendSection(lines, 'Code Symbols', result.nodes, 'code_symbol')
  appendSection(lines, 'Test Cases', result.nodes, 'test_case')
  appendSection(lines, 'Bugs', result.nodes, 'bug')

  if (result.recommendedChecks.length > 0) {
    lines.push('## Recommended Checks', '')
    for (const check of result.recommendedChecks) {
      lines.push(`- ${check}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

function appendSection(lines: string[], title: string, nodes: ContextNode[], type: ContextNode['type']): void {
  const selected = nodes.filter((node) => node.type === type)
  if (selected.length === 0) {
    return
  }
  lines.push(`## ${title}`, '')
  for (const node of selected) {
    lines.push(`- ${node.id}: ${node.title}`)
    if (node.source.uri) {
      lines.push(`  Source: ${node.source.uri}`)
    }
    if (node.content && type === 'test_case') {
      lines.push(`  ${node.content}`)
    }
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
  return normalize([node.id, node.title, node.content, ...node.tags, ...Object.values(node.metadata).map(String)].join(' '))
}

function taskTokens(task: string): string[] {
  const asciiTokens = normalize(task).split(/[^a-z0-9/{}.-]+/).filter((token) => token.length >= 2)
  return asciiTokens.length > 0 ? asciiTokens : normalize(task).split('').filter((char) => /\p{Letter}|\p{Number}/u.test(char))
}

function nodeAllowedByModule(node: ContextNode, module: string | undefined, allowGlobalContext: boolean): boolean {
  if (!module) {
    return true
  }
  if (node.type !== 'code_symbol' && node.type !== 'module') {
    return allowGlobalContext
  }
  const target = module.toLowerCase()
  return [node.title, node.source.uri, String(node.metadata.file ?? ''), String(node.metadata.modulePath ?? '')]
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(target))
}

function recommendedChecksFor(nodes: ContextNode[], diagnostics: Diagnostic[], focus: string | undefined): string[] {
  if (nodes.length === 0) {
    return []
  }
  const checks = ['Review linked requirements, APIs, code symbols, tests, and diagnostics before implementation.']
  if (focus === 'review') {
    checks.push('Inspect graph diagnostics and linked source evidence before approving changes.')
  }
  if (focus === 'testing') {
    checks.push('Confirm acceptance criteria have executable regression coverage.')
  }
  if (nodes.some((node) => node.type === 'test_case')) {
    checks.push('Run or add tests covering the related requirements before shipping changes.')
  }
  if (diagnostics.length > 0) {
    checks.push('Resolve or consciously accept the listed diagnostics before handoff.')
  }
  return checks
}

function taskSlug(task: string, matchedNodes: ContextNode[]): string {
  const ascii = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (ascii.length > 0) {
    return ascii
  }
  const parts = []
  if (task.includes('支持')) parts.push('support')
  if (task.includes('部分')) parts.push('partial')
  if (task.includes('退款')) parts.push('refund')
  if (parts.length > 0) {
    return parts.join('-')
  }
  return matchedNodes[0]?.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task-context'
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function headline(value: string): string {
  return value.split(/[_-]/).map(capitalize).join(' ')
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function nodePriorityForFocus(node: ContextNode, focus: string | undefined): number {
  const order = focusTypeOrder(focus)
  const index = order.indexOf(node.type)
  return index === -1 ? order.length : index
}

function focusTypeOrder(focus: string | undefined): ContextNodeType[] {
  switch (focus) {
    case 'implementation':
      return ['requirement', 'acceptance_criteria', 'api_contract', 'code_symbol', 'test_case', 'bug', 'risk']
    case 'review':
      return ['diagnostic', 'risk', 'requirement', 'api_contract', 'code_symbol', 'test_case', 'bug']
    case 'testing':
      return ['requirement', 'acceptance_criteria', 'test_case', 'bug', 'api_contract', 'code_symbol', 'risk']
    case 'product':
      return ['requirement', 'business_rule', 'acceptance_criteria', 'decision', 'risk']
    case 'design':
      return ['design_spec', 'page', 'ui_component', 'requirement', 'acceptance_criteria']
    default:
      return ['requirement', 'business_rule', 'acceptance_criteria', 'api_contract', 'code_symbol', 'test_case', 'bug', 'risk']
  }
}
