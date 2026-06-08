import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  nodeContent,
  nodeStringProperty,
  primarySourceRef,
  sourceUri
} from '../graph/model.js'
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
    include: ['Project', 'Domain', 'SourceGroup', 'Repository', 'Module', 'Package', 'Requirement', 'BusinessRule', 'Decision', 'Risk', 'Diagnostic'],
    diagnostics: true
  },
  {
    name: 'implementation',
    title: 'Implementation Context',
    include: [
      'Requirement',
      'SourceGroup',
      'AcceptanceCriteria',
      'APIEndpoint',
      'Route',
      'CodeSymbol',
      'Module',
      'File',
      'ConfigItem',
      'Dependency',
      'EntryPoint',
      'TestCase',
      'Incident',
      'Risk'
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
    include: ['Requirement', 'AcceptanceCriteria', 'APIEndpoint', 'TestCase', 'Incident', 'Risk', 'CodeSymbol'],
    diagnostics: true
  },
  {
    name: 'product',
    title: 'Product Context',
    detect: ['Requirement', 'BusinessRule', 'AcceptanceCriteria', 'Decision', 'Risk'],
    include: ['Requirement', 'SourceGroup', 'BusinessRule', 'AcceptanceCriteria', 'Decision', 'Risk']
  },
  {
    name: 'design',
    title: 'Design Context',
    detect: ['UIPage', 'UIComponent', 'UserFlow'],
    include: ['Requirement', 'UIPage', 'UIComponent', 'UserFlow', 'AcceptanceCriteria']
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
    return graph.nodes.filter((node) => !isProvenanceNode(node))
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
      lines.push(`- ${node.id}: ${node.name}`)
    }
    lines.push('')
  }

  if (definition.diagnostics && graph.diagnostics.length > 0) {
    lines.push('## Diagnostics', '')
    for (const diagnostic of graph.diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.type}: ${diagnostic.message}`)
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
    if (!['has_acceptance_criteria', 'exposed_as', 'relates_to', 'verified_by', 'implemented_by'].includes(edge.type)) {
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
  const diagnostics = graph.diagnostics.filter((diagnostic) => diagnostic.relatedNodes.some((nodeId) => nodeIds.has(nodeId)))

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

  appendSection(lines, 'Requirements', result.nodes, 'Requirement')
  appendSection(lines, 'Acceptance Criteria', result.nodes, 'AcceptanceCriteria')
  appendSection(lines, 'APIs', result.nodes, 'APIEndpoint')
  appendSection(lines, 'Code Symbols', result.nodes, 'CodeSymbol')
  appendSection(lines, 'Test Cases', result.nodes, 'TestCase')
  appendSection(lines, 'Incidents', result.nodes, 'Incident')

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
    lines.push(`- ${node.id}: ${node.name}`)
    const uri = sourceUri(node)
    if (uri) {
      lines.push(`  Source: ${uri}`)
    }
    const content = nodeContent(node)
    if (content && type === 'TestCase') {
      lines.push(`  ${content}`)
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
  return normalize([node.id, node.type, node.name, nodeContent(node), ...node.tags, ...Object.values(node.properties).map(String)].join(' '))
}

function taskTokens(task: string): string[] {
  const asciiTokens = normalize(task).split(/[^a-z0-9/{}.-]+/).filter((token) => token.length >= 2)
  return asciiTokens.length > 0 ? asciiTokens : normalize(task).split('').filter((char) => /\p{Letter}|\p{Number}/u.test(char))
}

function nodeAllowedByModule(node: ContextNode, module: string | undefined, allowGlobalContext: boolean): boolean {
  if (!module) {
    return true
  }
  if (node.type !== 'CodeSymbol' && node.type !== 'Module') {
    return allowGlobalContext
  }
  const target = module.toLowerCase()
  return [node.name, sourceUri(node) ?? '', nodeStringProperty(node, 'file') ?? '', nodeStringProperty(node, 'modulePath') ?? '']
    .map((value) => value.toLowerCase())
    .some((value) => value.includes(target))
}

function isProvenanceNode(node: ContextNode): boolean {
  return node.type === 'Source' || node.type === 'SourceSnapshot'
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
  if (nodes.some((node) => node.type === 'TestCase')) {
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
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_-]/).map(capitalize).join(' ')
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
      return ['Requirement', 'AcceptanceCriteria', 'APIEndpoint', 'CodeSymbol', 'TestCase', 'Incident', 'Risk']
    case 'review':
      return ['Diagnostic', 'Risk', 'Requirement', 'APIEndpoint', 'CodeSymbol', 'TestCase', 'Incident']
    case 'testing':
      return ['Requirement', 'AcceptanceCriteria', 'TestCase', 'Incident', 'APIEndpoint', 'CodeSymbol', 'Risk']
    case 'product':
      return ['Requirement', 'BusinessRule', 'AcceptanceCriteria', 'Decision', 'Risk']
    case 'design':
      return ['UIPage', 'UIComponent', 'UserFlow', 'Requirement', 'AcceptanceCriteria']
    default:
      return ['Requirement', 'BusinessRule', 'AcceptanceCriteria', 'APIEndpoint', 'CodeSymbol', 'TestCase', 'Incident', 'Risk']
  }
}
