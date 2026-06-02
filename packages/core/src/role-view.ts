import type { ContextProjectConfig, RoleConfig } from './config.js'
import type { ContextGraph, ContextNode } from './schemas.js'

export const DEFAULT_ROLES: Record<string, RoleConfig> = {
  project: { include: ['*'], diagnostics: true },
  product: { include: ['requirement', 'business_rule', 'acceptance_criteria', 'decision', 'risk'] },
  design: { include: ['requirement', 'design_spec', 'page', 'ui_component'] },
  frontend: {
    include: ['requirement', 'design_spec', 'api_contract', 'ui_component', 'code_symbol', 'test_case']
  },
  backend: {
    include: ['requirement', 'api_contract', 'code_symbol', 'database', 'test_case', 'bug']
  },
  tester: { include: ['requirement', 'acceptance_criteria', 'test_case', 'bug', 'risk'] },
  reviewer: { include: ['*'], diagnostics: true }
}

export function roleConfigFor(config: ContextProjectConfig, role: string): RoleConfig {
  return config.roles[role] ?? DEFAULT_ROLES[role] ?? { include: ['*'] }
}

export function filterNodesForRole(
  graph: ContextGraph,
  config: ContextProjectConfig,
  role: string
): ContextNode[] {
  const roleConfig = roleConfigFor(config, role)
  if (roleConfig.include.includes('*')) {
    return graph.nodes
  }

  return graph.nodes.filter((node) => roleConfig.include.includes(node.type))
}

export function renderRoleView(
  role: string,
  graph: ContextGraph,
  config: ContextProjectConfig
): string {
  const nodes = filterNodesForRole(graph, config, role)
  const title = `${capitalize(role)} Role Context`
  const lines = [
    `# ${title}`,
    '',
    '## Scope',
    '',
    `This view is optimized for the ${role} role in ${config.project.name}.`,
    ''
  ]

  if (config.project.domains.length > 0) {
    lines.push('## Related Domains', '')
    for (const domain of config.project.domains) {
      lines.push(`- ${domain}`)
    }
    lines.push('')
  }

  lines.push('## Context Nodes', '')
  for (const [type, typedNodes] of groupByType(nodes)) {
    lines.push(`### ${type}`, '')
    for (const node of typedNodes) {
      lines.push(`- ${node.id}: ${node.title}`)
    }
    lines.push('')
  }

  const roleConfig = roleConfigFor(config, role)
  if (roleConfig.diagnostics && graph.diagnostics.length > 0) {
    lines.push('## Diagnostics', '')
    for (const diagnostic of graph.diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

function groupByType(nodes: ContextNode[]): Array<[string, ContextNode[]]> {
  const groups = new Map<string, ContextNode[]>()
  for (const node of nodes) {
    groups.set(node.type, [...(groups.get(node.type) ?? []), node])
  }
  return [...groups.entries()]
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1)
}

