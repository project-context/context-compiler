#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Command } from 'commander'
import {
  compileContextProject,
  createCodeIndexParserPlugin,
  discoverProjectInventory,
  explainTrace,
  generateTaskContext,
  indexCodeProject,
  loadContextConfig,
  queryGraph,
  readGraphFiles,
  renderTaskContextMarkdown,
  resolveOutputDir,
  writeCodeIndexFiles,
  writeInventoryFile,
  type ContextGraph,
  type ContextProjectConfig
} from '@context-compiler/core'
import { createFileEmitterPlugin } from '@context-compiler/plugin-emitters'
import { createMarkdownParserPlugin } from '@context-compiler/plugin-markdown'
import { createOpenApiParserPlugin } from '@context-compiler/plugin-openapi'
import { createTypeScriptParserPlugin } from '@context-compiler/plugin-typescript'

export interface RunCliOptions {
  cwd?: string
}

export interface RunCliResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface CliRuntime {
  cwd: string
  writeOut(message: string): void
  writeErr(message: string): void
  exitCode: number
}

export async function runCli(args: string[], options: RunCliOptions = {}): Promise<RunCliResult> {
  let stdout = ''
  let stderr = ''
  const runtime: CliRuntime = {
    cwd: options.cwd ?? process.cwd(),
    exitCode: 0,
    writeOut(message) {
      stdout += message
    },
    writeErr(message) {
      stderr += message
    }
  }

  const program = createProgram(runtime)
  try {
    await program.parseAsync(args, { from: 'user' })
  } catch (error) {
    runtime.exitCode = typeof error === 'object' && error && 'exitCode' in error
      ? Number((error as { exitCode: unknown }).exitCode)
      : 1
    if (!(typeof error === 'object' && error && 'code' in error)) {
      runtime.writeErr(`${error instanceof Error ? error.message : String(error)}\n`)
    }
  }

  return {
    exitCode: runtime.exitCode,
    stdout,
    stderr
  }
}

export function createProgram(runtime: CliRuntime): Command {
  const program = new Command()
    .name('context')
    .description('Compile project knowledge into structured AI context.')
    .exitOverride()
    .configureOutput({
      writeOut: (message) => runtime.writeOut(message),
      writeErr: (message) => runtime.writeErr(message)
    })

  program
    .command('init')
    .description('Initialize a Context Compiler config file.')
    .action(async () => {
      await initProject(runtime)
    })

  program
    .command('compile')
    .description('Compile project context.')
    .action(async () => {
      const graph = await compileProject(runtime.cwd)
      runtime.writeOut(
        `Compiled ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.diagnostics.length} diagnostics.\n`
      )
    })

  program
    .command('inventory')
    .description('Discover languages, modules, build systems, docs, APIs, and tests.')
    .action(async () => {
      const { config } = await loadContextConfig(runtime.cwd)
      const inventory = await discoverProjectInventory({ rootDir: runtime.cwd, config })
      await writeInventoryFile(inventory, resolveOutputDir(runtime.cwd))
      runtime.writeOut(formatInventorySummary(inventory))
    })

  program
    .command('index')
    .description('Build a language-agnostic code index.')
    .action(async () => {
      const { config } = await loadContextConfig(runtime.cwd)
      const inventory = await discoverProjectInventory({ rootDir: runtime.cwd, config })
      const index = await indexCodeProject({
        rootDir: runtime.cwd,
        inventory,
        providerNames: config.codeIndex?.providers,
        fallbackProvider: config.codeIndex?.fallbackProvider
      })
      const outputDir = resolveOutputDir(runtime.cwd)
      await writeInventoryFile(inventory, outputDir)
      await writeCodeIndexFiles(index, outputDir)
      runtime.writeOut(
        `Indexed ${index.nodes.filter((node) => node.type === 'code_symbol').length} code symbols with ${index.provider}.\n`
      )
      for (const diagnostic of index.diagnostics) {
        runtime.writeOut(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}\n`)
      }
    })

  program
    .command('validate')
    .description('Compile and print context diagnostics.')
    .action(async () => {
      const graph = await compileProject(runtime.cwd)
      if (graph.diagnostics.length === 0) {
        runtime.writeOut('No diagnostics.\n')
        return
      }

      for (const diagnostic of graph.diagnostics) {
        runtime.writeOut(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}\n`)
      }
      if (graph.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        runtime.exitCode = 1
      }
    })

  program
    .command('view')
    .argument('<role>', 'Role name, such as backend or reviewer.')
    .description('Print a compiled role view.')
    .action(async (role: string) => {
      const path = join(resolveOutputDir(runtime.cwd), 'views', `${role}.md`)
      runtime.writeOut(await readFile(path, 'utf8'))
    })

  program
    .command('query')
    .argument('<text>', 'Text to search in the compiled context graph.')
    .option('--limit <limit>', 'Maximum number of results.', '20')
    .description('Query compiled context nodes.')
    .action(async (text: string, options: { limit: string }) => {
      const graph = await readGraphFiles(resolveOutputDir(runtime.cwd))
      const results = queryGraph(graph, text, Number(options.limit))
      if (results.length === 0) {
        runtime.writeOut('No matching context nodes found.\n')
        return
      }
      for (const node of results) {
        runtime.writeOut(`${node.id}: ${node.title}\n`)
      }
    })

  program
    .command('explain')
    .argument('<nodeId>', 'Context node ID to explain.')
    .option('--expand <edgeTypes>', 'Comma-separated edge types to call out for expansion.')
    .description('Explain a context node source and graph relationships.')
    .action(async (nodeId: string, options: { expand?: string }) => {
      const graph = await readGraphFiles(resolveOutputDir(runtime.cwd))
      runtime.writeOut(formatExplanation(graph, nodeId, options.expand))
    })

  program
    .command('task')
    .argument('<task>', 'Task description to focus context around.')
    .requiredOption('--role <role>', 'Role name, such as backend or tester.')
    .option('--module <module>', 'Limit code context to a module path or module name.')
    .option('--max-tokens <tokens>', 'Approximate maximum context token budget.')
    .description('Generate focused task context from the compiled graph.')
    .action(async (task: string, options: { role: string; module?: string; maxTokens?: string }) => {
      const outputDir = resolveOutputDir(runtime.cwd)
      const graph = await readGraphFiles(outputDir)
      const { config } = await loadContextConfig(runtime.cwd)
      const result = generateTaskContext(graph, config, {
        task,
        role: options.role,
        module: options.module,
        maxTokens: options.maxTokens ? Number(options.maxTokens) : undefined
      })
      const markdown = renderTaskContextMarkdown(result)
      const tasksDir = join(outputDir, 'tasks')
      await mkdir(tasksDir, { recursive: true })
      await writeFile(join(tasksDir, `${result.outputSlug}.${options.role}.md`), markdown)
      runtime.writeOut(markdown)
    })

  return program
}

async function initProject(runtime: CliRuntime): Promise<void> {
  const configPath = join(runtime.cwd, 'context.config.ts')
  try {
    await access(configPath)
    runtime.writeErr('context.config.ts already exists.\n')
    runtime.exitCode = 1
    return
  } catch {
    // Missing config is the normal init path.
  }

  await writeFile(configPath, INITIAL_CONFIG)
  runtime.writeOut('Created context.config.ts\n')
}

async function compileProject(cwd: string): Promise<ContextGraph> {
  const { config } = await loadContextConfig(cwd)
  const result = await compileContextProject(config, {
    rootDir: cwd,
    parsers: [
      createCodeIndexParserPlugin(),
      createMarkdownParserPlugin(),
      createOpenApiParserPlugin(),
      createTypeScriptParserPlugin()
    ],
    emitters: [createFileEmitterPlugin()]
  })
  return result.graph
}

function formatExplanation(graph: ContextGraph, nodeId: string, expand?: string): string {
  const explanation = explainTrace(graph, nodeId)
  const lines = [
    `# ${explanation.node.id}`,
    '',
    `Title: ${explanation.node.title}`,
    `Type: ${explanation.node.type}`,
    `Source: ${explanation.node.source.uri}`,
    ''
  ]

  if (expand) {
    lines.push(`Expanded Edge Types: ${expand}`, '')
  }

  if (explanation.relatedEdges.length > 0) {
    lines.push('## Related Edges', '')
    for (const edge of explanation.relatedEdges) {
      lines.push(`- ${edge.from} --${edge.type}--> ${edge.to}`)
    }
    lines.push('')
  }

  if (explanation.relatedNodes.length > 0) {
    lines.push('## Related Nodes', '')
    for (const node of explanation.relatedNodes) {
      lines.push(`- ${node.id}: ${node.title}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

function formatInventorySummary(inventory: Awaited<ReturnType<typeof discoverProjectInventory>>): string {
  const lines = [
    `Project: ${inventory.project}`,
    `Languages: ${inventory.languages.map((language) => language.name).join(', ') || 'none'}`,
    `Modules: ${inventory.modules.length}`,
    `Build Systems: ${inventory.buildSystems.map((buildSystem) => buildSystem.type).join(', ') || 'none'}`,
    `Tests: ${inventory.testPaths.length}`,
    `Docs: ${inventory.docPaths.length}`,
    `APIs: ${inventory.apiFiles.length}`,
    ''
  ]
  return lines.join('\n')
}

const INITIAL_CONFIG = `import { defineContextProject } from '@context-compiler/core'

export default defineContextProject({
  project: {
    name: 'example-project',
    domains: [],
    defaultLanguage: 'zh-CN'
  },
  sources: [
    { type: 'markdown', name: 'product-docs', path: './docs/product' },
    { type: 'markdown', name: 'test-cases', path: './docs/tests' },
    { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
    { type: 'code', name: 'main-repo', path: '.', strategy: 'auto' }
  ],
  codeIndex: {
    languages: 'auto',
    providers: ['scip', 'tree-sitter', 'ctags'],
    fallbackProvider: 'ctags',
    deepAnalysisProviders: []
  },
  roles: {
    backend: { include: ['requirement', 'api_contract', 'code_symbol', 'test_case', 'bug'] },
    reviewer: { include: ['*'], diagnostics: true }
  }
})
`

if (process.argv[1]?.endsWith('index.js')) {
  const result = await runCli(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
