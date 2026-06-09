#!/usr/bin/env node
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGraphFactHistory, approveContextCorrectionProposal, applyContextCorrectionProposal, expandGraphTarget, expandContextPackage, generateTaskContext, explainGraphFact, getContextPackageCorrectionDecision, getContextCorrectionProposal, getContextPackage, getGraphScopeView, getLayeredSourceTrace, listContextPackageCorrectionDecisions, listContextPackageCorrections, listContextPackages, previewContextCorrectionProposal, proposeContextPackageCorrectionDecisionRevert, rejectContextCorrectionProposal, replayContextPackageCorrectionDecisions, renderContextView, renderTaskContextMarkdown, readEvidenceReportListing, revertGraphPatch, searchContextPackage, searchContextIndex } from '@context-compiler/core/runtime'
import { type ContextCorrectionProposalKind, type ContextCorrectionProposalStatus, type ContextSourceCorrectionDecisionStatus, type EvidenceReport, type ContextAgentTarget, type ContextRuntimeHealth } from '@context-compiler/core/runtime'
import { type AdapterRuntimeStatus } from '@context-compiler/core/extensions'
import { type ContextProgressReporter } from '@context-compiler/core/sdk'
import {
  applySubmittedPatchesProject,
  contextPath,
  compileProject,
  installAdapterRuntimesProject,
  integrateProject,
  listAdapterRuntimesProject,
  readCompiledProject,
  readOptionalFile,
  readRuntimeFreshness,
  syncProject,
  writeInitialConfig
} from './project.js'
import {
  formatAdapterRuntimeInstall,
  formatAdapterRuntimeList,
  formatContextCorrectionActionResult,
  formatContextCorrectionPreview,
  formatContextCorrectionProposal,
  formatContextPackageCorrectionInbox,
  formatContextPackageExpansion,
  formatContextPackageList,
  formatContextPackageSearch,
  formatContextPackageView,
  formatContextSourceCorrectionDecisionActionResult,
  formatContextSourceCorrectionDecisionList,
  formatContextSourceCorrectionDecisionView,
  formatContextSourceCorrectionReplay,
  formatDiagnostics,
  formatGraphExpansion,
  formatGraphFactExplanation,
  formatGraphFactHistory,
  formatGraphScopeView,
  formatLayeredSourceTrace,
  formatNodes,
  formatRuntimeHealth
} from './formatters.js'
import { createRuntime, type RunCliOptions, type RunCliResult } from './runtime.js'
import { startContextViewerServer } from './viewer-server.js'
import { createProgressFormatter } from './progress.js'

export type { RunCliOptions, RunCliResult }
export { compileProject } from './project.js'

export const DEFAULT_GRAPH_INSPECT_PORT = 19527

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
      case 'clean': {
        const removed = await cleanContextWorkspace(runtime.cwd)
        runtime.writeOut(removed ? 'Removed .context\n' : 'No .context directory to clean\n')
        break
      }
      case 'compile': {
        const { graph } = await compileProject(runtime.cwd, {
          onProgress: createCliProgressReporter(runtime, options)
        })
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
      case 'adapters': {
        if (rest[0] === 'list') {
          const entries = await listAdapterRuntimesProject(runtime.cwd)
          runtime.writeOut(formatAdapterRuntimeList(entries))
          break
        }
        if (rest[0] === 'install') {
          const result = await installAdapterRuntimesProject(runtime.cwd, rest[1], {
            onProgress: createCliProgressReporter(runtime, options)
          })
          runtime.writeOut(formatAdapterRuntimeInstall(result.entries))
          break
        }
        throw new Error('Usage: context adapters list | context adapters install [adapter-id]')
      }
      case 'validate': {
        const { graph } = await readCompiledProject(runtime.cwd)
        runtime.writeOut(formatDiagnostics(graph.diagnostics))
        break
      }
      case 'doctor': {
        const { graph, config } = await readCompiledProject(runtime.cwd)
        const emitted = await readOptionalFile(contextPath(runtime.cwd, config, 'health.json'))
        const freshness = await readRuntimeFreshness(runtime.cwd, config)
        const runSummary = await readOptionalFile(contextPath(runtime.cwd, config, 'runtime', 'run-summary.json'))
        const adapterRuntimeStatuses = adapterRuntimeStatusesFromRunSummary(runSummary)
        if (emitted) {
          runtime.writeOut(formatRuntimeHealth(JSON.parse(emitted) as ContextRuntimeHealth, graph.diagnostics, freshness, adapterRuntimeStatuses))
        } else {
          runtime.writeOut(formatDiagnostics(graph.diagnostics))
        }
        break
      }
      case 'view': {
        const viewName = rest[0] ?? 'project'
        const { graph, config } = await readCompiledProject(runtime.cwd)
        const emitted = await readOptionalFile(contextPath(runtime.cwd, config, 'debug', 'views', `${viewName}.md`))
        runtime.writeOut(emitted ?? renderContextView(graph, config, viewName))
        break
      }
      case 'query': {
        const query = rest.join(' ')
        const { graph, config } = await readCompiledProject(runtime.cwd)
        const result = await searchContextIndex({
          outputDir: contextPath(runtime.cwd, config),
          graph,
          query
        })
        runtime.writeOut(formatNodes(result.results))
        break
      }
      case 'explain': {
        const factId = rest[0]
        if (!factId) {
          throw new Error('Usage: context explain <node-or-edge-id> [--full] [--json] [--limit-sources N]')
        }
        const { config } = await readCompiledProject(runtime.cwd)
        const explanation = await explainGraphFact({ outputDir: contextPath(runtime.cwd, config), factId, ...explainOptionsFromArgs(rest) })
        runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(explanation, null, 2)}\n` : formatGraphFactExplanation(explanation))
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
        const taskPackDir = contextPath(runtime.cwd, config, 'packs', 'tasks')
        const debugTaskDir = contextPath(runtime.cwd, config, 'debug', 'tasks')
        await rm(contextPath(runtime.cwd, config, 'tasks'), { recursive: true, force: true })
        await mkdir(taskPackDir, { recursive: true })
        await mkdir(debugTaskDir, { recursive: true })
        const taskFile = `${result.outputSlug}.${focus ?? 'context'}`
        await writeFile(join(taskPackDir, `${taskFile}.json`), `${JSON.stringify({ schemaVersion: 'context-task-pack.v1', ...result, markdown }, null, 2)}\n`)
        await writeFile(join(debugTaskDir, `${taskFile}.md`), markdown)
        runtime.writeOut(markdown)
        break
	      }
	      case 'inventory': {
	        const { config } = await readCompiledProject(runtime.cwd)
	        const inventory = await readOptionalFile(contextPath(runtime.cwd, config, 'manifest.json'))
	        runtime.writeOut(inventory ?? 'No emitted inventory found. Run context compile first.\n')
	        break
      }
      case 'index': {
        const { graph } = await readCompiledProject(runtime.cwd)
        runtime.writeOut(formatNodes(graph.nodes.filter((node) => node.type === 'CodeSymbol')))
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
      case 'package': {
        const subcommand = rest[0]
        const { config } = await readCompiledProject(runtime.cwd)
        const outputDir = contextPath(runtime.cwd, config)
        if (subcommand === 'list') {
          const list = await listContextPackages({ outputDir })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(list, null, 2)}\n` : formatContextPackageList(list))
          break
        }
        if (subcommand === 'show') {
          const packageRef = rest[1]
          if (!packageRef) {
            throw new Error('Usage: context package show <package-id|path|title> [--json] [--full]')
          }
          if (rest.includes('--full')) {
            const expansion = await expandContextPackage({ outputDir, packageRef, mode: 'full' })
            runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(expansion, null, 2)}\n` : formatContextPackageExpansion(expansion))
            break
          }
          const view = await getContextPackage({ outputDir, packageRef })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(view, null, 2)}\n` : formatContextPackageView(view))
          break
        }
        if (subcommand === 'expand') {
          const packageRef = rest[1]
          if (!packageRef) {
            throw new Error('Usage: context package expand <package-id|path|title> [--json] [--full]')
          }
          const expansion = await expandContextPackage({ outputDir, packageRef, mode: rest.includes('--full') ? 'full' : 'summary' })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(expansion, null, 2)}\n` : formatContextPackageExpansion(expansion))
          break
        }
        if (subcommand === 'corrections') {
          const packageRef = rest[1] && !rest[1].startsWith('--') ? rest[1] : undefined
          const inbox = await listContextPackageCorrections({
            outputDir,
            packageRef,
            status: correctionStatusOption(rest),
            kind: correctionKindOption(rest)
          })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(inbox, null, 2)}\n` : formatContextPackageCorrectionInbox(inbox))
          break
        }
        if (subcommand === 'correction') {
          const action = rest[1]
          if (action === 'decisions') {
            const packageRef = rest[2] && !rest[2].startsWith('--') ? rest[2] : undefined
            const decisions = await listContextPackageCorrectionDecisions({
              outputDir,
              packageRef,
              kind: correctionKindOption(rest),
              status: sourceCorrectionDecisionStatusOption(rest),
              includeDrift: rest.includes('--include-drift')
            })
            runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(decisions, null, 2)}\n` : formatContextSourceCorrectionDecisionList(decisions))
            break
          }
          if (action === 'decision') {
            const decisionAction = rest[2]
            const decisionRef = rest[3]
            if (decisionAction === 'show') {
              if (!decisionRef) {
                throw new Error('Usage: context package correction decision show <decision-id> [--json]')
              }
              const decision = await getContextPackageCorrectionDecision({ outputDir, decisionId: decisionRef })
              runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(decision, null, 2)}\n` : formatContextSourceCorrectionDecisionView(decision))
              break
            }
            if (decisionAction === 'replay') {
              if (!decisionRef) {
                throw new Error('Usage: context package correction decision replay <decision-id|package-ref> [--json] [--dry-run]')
              }
              const replay = await replayContextPackageCorrectionDecisions({
                outputDir,
                decisionId: decisionRef.startsWith('SOURCE-CORRECTION-') ? decisionRef : undefined,
                packageRef: decisionRef.startsWith('SOURCE-CORRECTION-') ? undefined : decisionRef,
                dryRun: rest.includes('--dry-run')
              })
              runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(replay, null, 2)}\n` : formatContextSourceCorrectionReplay(replay))
              break
            }
            if (decisionAction === 'revert') {
              if (!decisionRef) {
                throw new Error('Usage: context package correction decision revert <decision-id> [--reason "..."] [--json]')
              }
              const result = await proposeContextPackageCorrectionDecisionRevert({
                outputDir,
                decisionId: decisionRef,
                actor: { type: 'human', name: 'context-cli' },
                reason: optionValue(rest, '--reason'),
                config
              })
              runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatContextSourceCorrectionDecisionActionResult(result))
              break
            }
            throw new Error('Usage: context package correction decision show|replay|revert <decision-id|package-ref> [--json]')
          }
          const proposalId = rest[2]
          if (action === 'show') {
            if (!proposalId) {
              throw new Error('Usage: context package correction show <proposal-id> [--json]')
            }
            const proposal = await getContextCorrectionProposal({ outputDir, proposalId })
            runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(proposal, null, 2)}\n` : formatContextCorrectionProposal(proposal))
            break
          }
          if (action === 'preview') {
            if (!proposalId) {
              throw new Error('Usage: context package correction preview <proposal-id> [--json]')
            }
            const preview = await previewContextCorrectionProposal({ outputDir, proposalId })
            runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(preview, null, 2)}\n` : formatContextCorrectionPreview(preview))
            break
          }
          if (action === 'approve') {
            if (!proposalId) {
              throw new Error('Usage: context package correction approve <proposal-id> [--reason "..."] [--json]')
            }
            const result = await approveContextCorrectionProposal({ outputDir, proposalId, actor: { type: 'human', name: 'context-cli' }, reason: optionValue(rest, '--reason') })
            runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatContextCorrectionActionResult(result))
            break
          }
          if (action === 'reject') {
            if (!proposalId) {
              throw new Error('Usage: context package correction reject <proposal-id> [--reason "..."] [--json]')
            }
            const result = await rejectContextCorrectionProposal({ outputDir, proposalId, actor: { type: 'human', name: 'context-cli' }, reason: optionValue(rest, '--reason') })
            runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatContextCorrectionActionResult(result))
            break
          }
          if (action === 'apply') {
            if (!proposalId) {
              throw new Error('Usage: context package correction apply <proposal-id> [--dry-run] [--json]')
            }
            const result = await applyContextCorrectionProposal({
              outputDir,
              proposalId,
              dryRun: rest.includes('--dry-run'),
              actor: { type: 'human', name: 'context-cli' },
              reason: optionValue(rest, '--reason'),
              config
            })
            runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatContextCorrectionActionResult(result))
            if (result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
              runtime.exitCode = 1
            }
            break
          }
          throw new Error('Usage: context package correction decisions [package] [--json] | context package correction decision show|replay|revert <decision-id|package-ref> [--json] | context package correction show|preview|approve|reject|apply <proposal-id> [--json]')
        }
        if (subcommand === 'search') {
          const query = positionalArgs(rest.slice(1), ['--package', '--limit']).join(' ')
          if (!query) {
            throw new Error('Usage: context package search <query> [--package <id|path|title>] [--json] [--limit N]')
          }
          const search = await searchContextPackage({
            outputDir,
            query,
            packageRef: optionValue(rest, '--package'),
            limit: numberOptionValue(rest, '--limit')
          })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(search, null, 2)}\n` : formatContextPackageSearch(search))
          break
        }
        throw new Error('Usage: context package list [--json] | context package show <package-id|path|title> [--json] [--full] | context package expand <package-id|path|title> [--json] [--full] | context package corrections [package] [--json] | context package correction decisions [package] [--json] | context package correction decision show|replay|revert <decision-id|package-ref> [--json] | context package correction show|preview|approve|reject|apply <proposal-id> [--json] | context package search <query> [--package <id|path|title>] [--json]')
      }
      case 'graph': {
        if (rest[0] === 'inspect') {
          throw new Error('Usage: context graph inspect [--host 127.0.0.1] [--port 19527|0|N] [--open]. This long-running command must be run from the context CLI binary.')
        }
        if (rest[0] === 'evidence') {
          const { config } = await readCompiledProject(runtime.cwd)
          const result = await readEvidenceReportListing(contextPath(runtime.cwd, config), {
            scopeId: optionValue(rest, '--scope')
          })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatEvidenceReportListing(result))
          break
        }
        if (rest[0] === 'explain') {
          const factId = rest[1]
          if (!factId) {
            throw new Error('Usage: context graph explain <node-or-edge-id> [--full] [--json] [--limit-sources N]')
          }
          const { config } = await readCompiledProject(runtime.cwd)
          const explanation = await explainGraphFact({ outputDir: contextPath(runtime.cwd, config), factId, ...explainOptionsFromArgs(rest) })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(explanation, null, 2)}\n` : formatGraphFactExplanation(explanation))
          break
        }
        if (rest[0] === 'history') {
          const factId = rest[1]
          if (!factId) {
            throw new Error('Usage: context graph history <node-or-edge-id> [--json]')
          }
          const { config } = await readCompiledProject(runtime.cwd)
          const history = await buildGraphFactHistory({ outputDir: contextPath(runtime.cwd, config), factId })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(history, null, 2)}\n` : formatGraphFactHistory(history))
          break
        }
        if (rest[0] === 'scope') {
          const scopeId = rest[1]
          if (!scopeId) {
            throw new Error('Usage: context graph scope <scope-id> [--json] [--full] [--limit-nodes N] [--limit-edges N]')
          }
          const { config } = await readCompiledProject(runtime.cwd)
          const view = await getGraphScopeView({
            outputDir: contextPath(runtime.cwd, config),
            scopeId,
            ...drillOptionsFromArgs(rest)
          })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(view, null, 2)}\n` : formatGraphScopeView(view))
          break
        }
        if (rest[0] === 'expand') {
          const targetId = rest[1]
          if (!targetId) {
            throw new Error('Usage: context graph expand <scope-node-or-edge-id> [--json] [--full] [--depth N] [--direction up|down|around]')
          }
          const { config } = await readCompiledProject(runtime.cwd)
          const expansion = await expandGraphTarget({
            outputDir: contextPath(runtime.cwd, config),
            targetId,
            ...drillOptionsFromArgs(rest),
            direction: directionFromArgs(rest),
            depth: numberOptionValue(rest, '--depth')
          })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(expansion, null, 2)}\n` : formatGraphExpansion(expansion))
          break
        }
        if (rest[0] === 'trace') {
          const factId = rest[1]
          if (!factId) {
            throw new Error('Usage: context graph trace <node-or-edge-id> [--json] [--full] [--limit-sources N]')
          }
          const { config } = await readCompiledProject(runtime.cwd)
          const trace = await getLayeredSourceTrace({
            outputDir: contextPath(runtime.cwd, config),
            factId,
            ...drillOptionsFromArgs(rest),
            limitSources: numberOptionValue(rest, '--limit-sources')
          })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(trace, null, 2)}\n` : formatLayeredSourceTrace(trace))
          break
        }
        if (rest[0] === 'revert') {
          const patchId = rest[1]
          if (!patchId) {
            throw new Error('Usage: context graph revert <patch-id> [--dry-run] [--json]')
          }
          const { config } = await readCompiledProject(runtime.cwd)
          const result = await revertGraphPatch({
            outputDir: contextPath(runtime.cwd, config),
            patchId,
            dryRun: rest.includes('--dry-run')
          })
          runtime.writeOut(rest.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatGraphPatchRevertResult(result))
          break
        }
        if (rest[0] !== 'apply-patches') {
          throw new Error('Usage: context graph inspect [--port 19527] [--open] | context graph apply-patches [--dry-run] | context graph evidence [--scope <scopeId>] [--json] | context graph scope <scopeId> [--json] | context graph expand <id> [--json] | context graph trace <id> [--json] | context graph explain <id> [--full] [--json] | context graph history <id> [--json] | context graph revert <patch-id> [--dry-run] [--json]')
        }
        const result = await applySubmittedPatchesProject(runtime.cwd, { dryRun: rest.includes('--dry-run') })
        runtime.writeOut(formatPatchApplyResult(result))
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

async function cleanContextWorkspace(cwd: string): Promise<boolean> {
  const outputDir = resolve(cwd, '.context')
  try {
    await access(outputDir)
  } catch {
    return false
  }
  await rm(outputDir, { recursive: true, force: true })
  return true
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function correctionStatusOption(args: string[]): ContextCorrectionProposalStatus | undefined {
  const value = optionValue(args, '--status')
  if (!value) {
    return undefined
  }
  if (value === 'proposed' || value === 'approved' || value === 'rejected' || value === 'applied') {
    return value
  }
  throw new Error('Usage: --status proposed|approved|rejected|applied')
}

function sourceCorrectionDecisionStatusOption(args: string[]): ContextSourceCorrectionDecisionStatus | undefined {
  const value = optionValue(args, '--status')
  if (!value) {
    return undefined
  }
  if (value === 'applied' || value === 'superseded' || value === 'reverted' || value === 'invalid') {
    return value
  }
  throw new Error('Usage: --status applied|superseded|reverted|invalid')
}

function correctionKindOption(args: string[]): ContextCorrectionProposalKind | undefined {
  const value = optionValue(args, '--kind')
  if (!value) {
    return undefined
  }
  if (value === 'relabel' || value === 'split' || value === 'merge' || value === 'rehome' || value === 'confirm_relation' || value === 'reject_relation') {
    return value
  }
  throw new Error('Usage: --kind relabel|split|merge|rehome|confirm_relation|reject_relation')
}

function positionalArgs(args: string[], valueOptions: string[]): string[] {
  const positionals: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json' || arg === '--full') {
      continue
    }
    if (valueOptions.includes(arg)) {
      index += 1
      continue
    }
    if (arg.startsWith('--')) {
      continue
    }
    positionals.push(arg)
  }
  return positionals
}

function numberOptionValue(args: string[], name: string): number | undefined {
  const value = optionValue(args, name)
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric option ${name}: ${value}`)
  }
  return parsed
}

function explainOptionsFromArgs(args: string[]) {
  const hasLimit = ['--limit-sources', '--limit-evidence', '--limit-relations', '--limit-provenance'].some((name) => args.includes(name))
  return {
    mode: hasLimit ? 'summary' as const : args.includes('--full') || args.includes('--json') ? 'full' as const : 'summary' as const,
    limitSources: numberOptionValue(args, '--limit-sources'),
    limitEvidence: numberOptionValue(args, '--limit-evidence'),
    limitRelations: numberOptionValue(args, '--limit-relations'),
    limitProvenance: numberOptionValue(args, '--limit-provenance')
  }
}

function drillOptionsFromArgs(args: string[]) {
  return {
    mode: args.includes('--full') ? 'full' as const : 'summary' as const,
    limitNodes: numberOptionValue(args, '--limit-nodes'),
    limitEdges: numberOptionValue(args, '--limit-edges'),
    limitChildScopes: numberOptionValue(args, '--limit-child-scopes'),
    limitSourceRefs: numberOptionValue(args, '--limit-source-refs'),
    limitEvidence: numberOptionValue(args, '--limit-evidence')
  }
}

function directionFromArgs(args: string[]): 'up' | 'down' | 'around' | undefined {
  const direction = optionValue(args, '--direction')
  if (direction === undefined) {
    return undefined
  }
  if (direction === 'up' || direction === 'down' || direction === 'around') {
    return direction
  }
  throw new Error(`Invalid graph expand direction: ${direction}`)
}

function adapterRuntimeStatusesFromRunSummary(content: string | undefined): AdapterRuntimeStatus[] {
  if (!content) {
    return []
  }
  try {
    const parsed = JSON.parse(content) as { adapterRuntimeStatuses?: AdapterRuntimeStatus[] }
    return Array.isArray(parsed.adapterRuntimeStatuses) ? parsed.adapterRuntimeStatuses : []
  } catch {
    return []
  }
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
  clean      Remove the generated .context workspace
  compile    Compile sources and install missing managed adapter runtimes
  validate   Print graph diagnostics
  doctor     Print runtime health and graph diagnostics
  view       Print an inferred context view
  query      Search compiled graph nodes
  explain    Explain one graph node/edge with provenance
  task       Generate focused task context
  integrate  Install Codex/Claude native integration files
  adapters   List or explicitly install managed third-party adapter runtimes
  inventory  Print emitted manifest
  index      Print code symbol nodes
  package    List, show, expand, or search L0 context packages
  graph      Inspect evidence, scopes, expansions, traces, fact history, revert proposals, or apply patch cycles
  mcp start  Print the project MCP server config; add --stdio to run the stdio server
`
}

function formatPatchApplyResult(result: Awaited<ReturnType<typeof applySubmittedPatchesProject>>): string {
  return [
    `Dry run: ${result.dryRun ? 'true' : 'false'}`,
    `Base revision: ${result.baseRevision.id}`,
    `New revision: ${result.newRevision?.id ?? 'none'}`,
    `Inbox patches: ${result.inboxPatches.length}`,
    `Evidence reports: ${result.evidenceReports.length}`,
    `Evidence patches: ${result.evidencePatches.length}`,
    `Applied patches: ${result.appliedPatches.length}`,
    `Rejected patches: ${result.rejectedPatches.length}`,
    `Diagnostics: ${result.diagnostics.length}`,
    `Graph: ${result.graph.nodes} nodes, ${result.graph.edges} edges`,
    ''
  ].join('\n')
}

function formatGraphPatchRevertResult(result: Awaited<ReturnType<typeof revertGraphPatch>>): string {
  return [
    `Dry run: ${result.dryRun ? 'true' : 'false'}`,
    `Patch: ${result.patchId}`,
    `Reverse patch: ${result.reversePatch?.id ?? 'none'}`,
    `Submitted: ${result.submitted ? 'true' : 'false'}`,
    result.path ? `Path: ${result.path}` : undefined,
    `Operations: ${result.reversePatch?.operations.length ?? 0}`,
    `Diagnostics: ${result.diagnostics.length}`,
    ''
  ].filter((line): line is string => typeof line === 'string').join('\n')
}

function formatEvidenceReportListing(result: Awaited<ReturnType<typeof readEvidenceReportListing>>): string {
  const lines = [
    `Evidence reports: ${result.counts.reports}`,
    `Findings: ${result.counts.findings}`,
    `Derived patches: ${result.counts.derivedPatches}`,
    `Pending patches: ${result.counts.pendingPatches}`,
    `Processed patches: ${result.counts.processedPatches}`
  ]
  for (const report of result.reports) {
    lines.push(`- ${report.id} scope=${report.scopeId} findings=${report.findings.length}`)
    for (const finding of report.findings) {
      lines.push(`  - ${formatFinding(finding)}`)
    }
  }
  for (const patch of result.derivedPatches) {
    lines.push(`- ${patch.id} processed=${patch.processed ? 'true' : 'false'} operations=${patch.operations.length}`)
  }
  lines.push('')
  return lines.join('\n')
}

function formatFinding(finding: EvidenceReport['findings'][number]): string {
  return [
    finding.type,
    finding.nodeId,
    finding.targetGroupId ? `-> ${finding.targetGroupId}` : undefined,
    `confidence=${finding.confidence}`
  ].filter(Boolean).join(' ')
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
  if (parsed.args[0] === 'mcp' && parsed.args[1] === 'start' && (parsed.args.includes('--stdio') || process.env.CONTEXT_MCP_STDIO === '1')) {
    const { startContextMcpStdioServer } = await import('@context-compiler/mcp-server')
    await startContextMcpStdioServer({ rootDir: parsed.cwd ?? process.cwd() })
  } else if (parsed.args[0] === 'graph' && parsed.args[1] === 'inspect') {
    try {
      await runGraphInspectServer(parsed.args.slice(2), parsed.cwd ?? process.cwd())
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  } else {
    const result = await runCli(parsed.args, {
      cwd: parsed.cwd,
      progress: true,
      progressStyle: process.stdout.isTTY ? 'bar' : 'log',
      stream: true,
      stdout: (chunk) => process.stdout.write(chunk),
      stderr: (chunk) => process.stderr.write(chunk)
    })
    process.exitCode = result.exitCode
  }
}

function createCliProgressReporter(runtime: ReturnType<typeof createRuntime>, options: RunCliOptions): ContextProgressReporter | undefined {
  if (!options.progress) {
    return undefined
  }
  const formatter = createProgressFormatter({ style: options.progressStyle ?? 'log' })
  return (event) => {
    const formatted = formatter.format(event)
    if (!formatted) {
      return
    }
    if (event.stream === 'stderr' || event.type.endsWith('.failed')) {
      runtime.writeErr(formatted)
      return
    }
    runtime.writeOut(formatted)
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

async function runGraphInspectServer(args: string[], cwd: string): Promise<void> {
  const inspectOptions = inspectOptionsFromArgs(args)
  const { config } = await readCompiledProject(cwd)
  const outputDir = contextPath(cwd, config)
  const server = await startContextViewerServer({
    outputDir,
    viewerDistDir: defaultViewerDistDir(),
    host: inspectOptions.host,
    port: inspectOptions.port
  })
  process.stdout.write(`Graph inspector: ${server.url}\n`)
  process.stdout.write(`Context: ${outputDir}\n`)
  process.stdout.write('Press Ctrl+C to stop.\n')
  if (inspectOptions.open) {
    openLocalUrl(server.url)
  }
  await new Promise<void>((resolveStop) => {
    const stop = () => {
      void server.close().finally(() => resolveStop())
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

export function inspectOptionsFromArgs(args: string[]): { host: string; port: number; open: boolean } {
  return {
    host: optionValue(args, '--host') ?? '127.0.0.1',
    port: numberOptionValue(args, '--port') ?? DEFAULT_GRAPH_INSPECT_PORT,
    open: args.includes('--open')
  }
}

function defaultViewerDistDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../viewer/dist')
}

function openLocalUrl(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}
