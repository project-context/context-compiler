import { defineComponent, type ContextComponent, type ContextGraph, type ContextNode } from '@context-compiler/core'

/** Create a governance component that redacts common secrets before emission. */
export function createRedactionGovernComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'govern.redaction',
      stage: 'govern',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph'],
      outputs: ['context-graph'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state) {
      const graph: ContextGraph = {
        nodes: state.graph.nodes.map(redactNode),
        edges: state.graph.edges,
        diagnostics: state.graph.diagnostics
      }
      return { graph, facts: graph.nodes }
    }
  })
}

function redactNode(node: ContextNode): ContextNode {
  return {
    ...node,
    content: node.content ? redact(node.content) : node.content,
    metadata: Object.fromEntries(Object.entries(node.metadata).map(([key, value]) => [key, typeof value === 'string' ? redact(value) : value]))
  }
}

function redact(value: string): string {
  return value.replace(/(secret|token|password|access[_-]?token)\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]')
}
