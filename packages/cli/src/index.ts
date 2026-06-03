#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  generateTaskContext,
  queryGraph,
  renderContextView,
  renderTaskContextMarkdown,
  type ContextAgentTarget,
  type ContextRuntimeHealth
} from '@context-compiler/core'
import {
  contextPath,
  compileProject,
  integrateProject,
  readCompiledProject,
  readOptionalFile,
  readRuntimeFreshness,
  syncProject,
  writeInitialConfig
} from './project.js'
import { formatDiagnostics, formatExplanation, formatNodes, formatRuntimeHealth } from './formatters.js'
import { createRuntime, type RunCliOptions, type RunCliResult } from './runtime.js'

export type { RunCliOptions, RunCliResult }

/** Run the `context` CLI with buffered stdout/stderr. */
export async function runCli(args: string[], options: RunCliOptions = {}): Promise<RunCliResult> {
  const runtime = createRuntime(options)
  const [command, ...rest] = args

  try {
    switch (command) {
      case undefined:
      case 'help':
      case '--help':
        runtime.writeOut(helpText())
        break
      case 'init':
        await writeInitialConfig(runtime.cwd)
        runtime.writeOut('Created context.config.json\n')
        break
      case 'sync': {
        const count = await syncProject(runtime.cwd)
        runtime.writeOut(`Synced ${count} sources\n`)
        break
      }
      case 'compile': {
        const { graph } = await compileProject(runtime.cwd)
        runtime.writeOut(`Compiled ${graph.nodes.length} nodes and ${graph.edges.length} edges\n`)
        break
      }
      case 'integrate': {
        const target = parseAgentTarget(rest[0] ?? 'all')
        const plan = await integrateProject(runtime.cwd, target)
        runtime.writeOut(`Integrated agents: ${plan.targetAgents.join(', ')}\n`)
        runtime.writeOut(`Files updated: ${plan.files.length}\n`)
        runtime.writeOut(`Install status: ${formatInstallStatus(plan)}\n`)
        break
      }
      case 'validate': {
        const { graph } = await readCompiledProject(runtime.cwd)
        runtime.writeOut(formatDiagnostics(graph.diagnostics))
        break
      }
      case 'doctor': {
        const { graph, config } = await readCompiledProject(runtime.cwd)
        const emitted = await readOptionalFile(contextPath(runtime.cwd, config, 'diagnostics', 'context-health.json'))
        const freshness = await readRuntimeFreshness(runtime.cwd, config)
        if (emitted) {
          runtime.writeOut(formatRuntimeHealth(JSON.parse(emitted) as ContextRuntimeHealth, graph.diagnostics, freshness))
        } else {
          runtime.writeOut(formatDiagnostics(graph.diagnostics))
        }
        break
      }
      case 'view': {
        const viewName = rest[0] ?? 'project'
        const { graph, config } = await readCompiledProject(runtime.cwd)
        const emitted = await readOptionalFile(contextPath(runtime.cwd, config, 'views', `${viewName}.md`))
        runtime.writeOut(emitted ?? renderContextView(graph, config, viewName))
        break
      }
      case 'query': {
        const query = rest.join(' ')
        const { graph } = await readCompiledProject(runtime.cwd)
        runtime.writeOut(formatNodes(queryGraph(graph, query)))
        break
      }
      case 'explain': {
        const nodeId = rest[0]
        if (!nodeId) {
          throw new Error('Usage: context explain <node-id>')
        }
        const { graph } = await readCompiledProject(runtime.cwd)
        runtime.writeOut(formatExplanation(graph, nodeId))
        break
      }
      case 'task': {
        const task = rest[0]
        if (!task) {
          throw new Error('Usage: context task <task> [--focus <focus>] [--module <module>]')
        }
        const focus = optionValue(rest, '--focus') ?? focusFromDeprecatedRole(optionValue(rest, '--role'))
        const module = optionValue(rest, '--module')
        const { graph, config } = await readCompiledProject(runtime.cwd)
        const result = generateTaskContext(graph, config, { task, focus, module })
        const markdown = renderTaskContextMarkdown(result)
        const tasksDir = contextPath(runtime.cwd, config, 'tasks')
        await mkdir(tasksDir, { recursive: true })
        await writeFile(join(tasksDir, `${result.outputSlug}.${focus ?? 'context'}.md`), markdown)
        runtime.writeOut(markdown)
        break
      }
      case 'inventory': {
        const { config } = await readCompiledProject(runtime.cwd)
        const inventory = await readOptionalFile(contextPath(runtime.cwd, config, 'context-manifest.json'))
        runtime.writeOut(inventory ?? 'No emitted inventory found. Run context compile first.\n')
        break
      }
      case 'index': {
        const { graph } = await readCompiledProject(runtime.cwd)
        runtime.writeOut(formatNodes(graph.nodes.filter((node) => node.type === 'code_symbol')))
        break
      }
      case 'mcp': {
        if (rest[0] !== 'start') {
          throw new Error('Usage: context mcp start')
        }
        const { config } = await readCompiledProject(runtime.cwd)
        runtime.writeOut(`MCP server config: ${contextPath(runtime.cwd, config, 'mcp', 'server.config.json')}\n`)
        break
      }
      default:
        throw new Error(`Unknown command: ${command}`)
    }
  } catch (error) {
    runtime.exitCode = 1
    runtime.writeErr(`${error instanceof Error ? error.message : String(error)}\n`)
  }

  return runtime.result()
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function focusFromDeprecatedRole(role: string | undefined): string | undefined {
  switch (role) {
    case 'backend':
    case 'frontend':
    case 'developer':
      return 'implementation'
    case 'reviewer':
      return 'review'
    case 'tester':
    case 'qa':
      return 'testing'
    case 'product':
      return 'product'
    case 'design':
    case 'designer':
      return 'design'
    default:
      return role
  }
}

function helpText(): string {
  return `context <command>

Commands:
  init       Create context.config.json
  sync       Write a parser-ready source manifest
  compile    Compile sources through the configured pipeline
  validate   Print graph diagnostics
  doctor     Print runtime health and graph diagnostics
  view       Print an inferred context view
  query      Search compiled graph nodes
  explain    Explain one node and its relations
  task       Generate focused task context
  integrate  Install Codex/Claude native integration files
  inventory  Print emitted manifest
  index      Print code symbol nodes
  mcp start  Start the project MCP server when run as the CLI binary
`
}

function parseAgentTarget(value: string): ContextAgentTarget {
  if (value === 'codex' || value === 'claude' || value === 'all') {
    return value
  }
  throw new Error('Usage: context integrate codex|claude|all')
}

function formatInstallStatus(plan: { files: Array<{ status?: string }>; targetAgents: string[] }): string {
  const statuses = new Set(plan.files.map((file) => file.status ?? 'planned'))
  return statuses.size === 1 ? [...statuses][0] : [...statuses].join(', ')
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const parsed = parseGlobalOptions(process.argv.slice(2))
  if (parsed.args[0] === 'mcp' && parsed.args[1] === 'start') {
    const { startContextMcpStdioServer } = await import('@context-compiler/mcp-server')
    await startContextMcpStdioServer({ rootDir: parsed.cwd ?? process.cwd() })
  } else {
    const result = await runCli(parsed.args, { cwd: parsed.cwd })
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exitCode = result.exitCode
  }
}

function parseGlobalOptions(args: string[]): { args: string[]; cwd?: string } {
  const nextArgs = []
  let cwd: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if ((arg === '--cwd' || arg === '-C') && args[index + 1]) {
      cwd = args[index + 1]
      index += 1
      continue
    }
    nextArgs.push(arg)
  }
  return { args: nextArgs, cwd }
}
