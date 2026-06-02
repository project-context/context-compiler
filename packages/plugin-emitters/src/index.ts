import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_ROLES,
  renderRoleView,
  writeCodeIndexFiles,
  writeGraphFiles,
  writeInventoryFile,
  type ContextGraph,
  type EmitterPlugin
} from '@context-compiler/core'

export function createFileEmitterPlugin(): EmitterPlugin {
  return {
    name: 'emitter-files',
    async emit(graph, context) {
      if (!context.config) {
        throw new Error('File emitter requires compiler context config.')
      }

      await writeGraphFiles(graph, context.outputDir)
      if (context.inventory) {
        await writeInventoryFile(context.inventory, context.outputDir)
      }
      if (context.codeIndex) {
        await writeCodeIndexFiles(context.codeIndex, context.outputDir)
      }
      await writeRoleViews(graph, context.outputDir, context.config)
      await writeManifest(graph, context.outputDir, context.config)
    }
  }
}

async function writeRoleViews(
  graph: ContextGraph,
  outputDir: string,
  config: NonNullable<Parameters<typeof renderRoleView>[2]>
): Promise<void> {
  const viewsDir = join(outputDir, 'views')
  await mkdir(viewsDir, { recursive: true })
  const roles = new Set([...Object.keys(DEFAULT_ROLES), ...Object.keys(config.roles)])

  await Promise.all(
    [...roles].map(async (role) => {
      await writeFile(join(viewsDir, `${role}.md`), renderRoleView(role, graph, config))
    })
  )
}

async function writeManifest(
  graph: ContextGraph,
  outputDir: string,
  config: NonNullable<Parameters<typeof renderRoleView>[2]>
): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  const views = Object.fromEntries(
    [...new Set([...Object.keys(DEFAULT_ROLES), ...Object.keys(config.roles)])].map((role) => [
      role,
      `.context/views/${role}.md`
    ])
  )

  await writeFile(
    join(outputDir, 'context-manifest.json'),
    JSON.stringify(
      {
        project: config.project.name,
        compiledAt: new Date().toISOString(),
        compilerVersion: '0.1.0',
        sources: config.sources.map((source) => ({
          id: source.name,
          type: source.type,
          uri: source.path,
          status: 'active'
        })),
        views,
        graph: {
          nodes: '.context/graph/nodes.jsonl',
          edges: '.context/graph/edges.jsonl',
          partitionedNodes: '.context/graph/nodes',
          partitionedEdges: '.context/graph/edges'
        },
        inventory: '.context/inventory.json',
        indexes: {
          code: '.context/indexes/code',
          symbol: '.context/indexes/symbol'
        },
        diagnostics: '.context/graph/diagnostics.jsonl',
        counts: {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          diagnostics: graph.diagnostics.length
        }
      },
      null,
      2
    ) + '\n'
  )
}
