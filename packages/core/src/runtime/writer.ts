import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ContextPack, ContextSkillDefinition } from '../contracts/runtime.js'
import { slug } from '../graph/model.js'
import type { ContextRuntimeWorkspace } from './workspace.js'
import { CONTEXT_RUNTIME_SCHEMA_VERSION } from './schema.js'

/** Write generated runtime workspace files. */
export async function writeContextRuntimeWorkspace(outputDir: string, workspace: ContextRuntimeWorkspace): Promise<void> {
  const preservedGroupingDecisions =
    await readOptionalText(join(outputDir, 'state', 'grouping-decisions.json')) ??
    await readOptionalText(join(outputDir, 'sources', 'grouping-decisions.json'))
  const preservedSourceCorrectionDecisions =
    await readOptionalText(join(outputDir, 'state', 'source-correction-decisions.jsonl')) ??
    await readOptionalText(join(outputDir, 'sources', 'correction-decisions.jsonl'))
  const preservedCorrectionProposals =
    await readOptionalText(join(outputDir, 'state', 'corrections.jsonl')) ??
    await readOptionalText(join(outputDir, 'proposals', 'corrections.jsonl'))
  const preservationRoot = join(outputDir, '.runtime-writer-preserve')
  await rm(preservationRoot, { recursive: true, force: true })
  const preservedExtensions = await preserveGeneratedDir(join(outputDir, 'extensions'), join(preservationRoot, 'extensions'))

  await Promise.all(
    [
      'model',
      'store',
      'index',
      'runtime',
      'mcp',
      'agents',
      'debug',
      'state',
      'cache',
      'extensions',
      // Remove legacy primary surfaces so stale files cannot mislead agents.
      'sources',
      'indexes',
      'views',
      'artifacts',
      'diagnostics',
      'proposals',
      'plans',
      'tasks',
      'tools',
      'skills',
      'plugins'
    ].map((dir) => rm(join(outputDir, dir), { recursive: true, force: true }))
  )
  await rm(join(outputDir, 'context-manifest.json'), { force: true })

  await writeJson(join(outputDir, 'manifest.json'), workspace.manifest)
  await writeSourceModelAndStore(outputDir, workspace, preservedGroupingDecisions, preservedSourceCorrectionDecisions)

  await writeJson(join(outputDir, 'index', 'manifest.json'), workspace.indexes.manifest)
  await writeGlobalIndexes(outputDir, workspace)
  for (const scoped of workspace.indexes.scopes) {
    if (shouldMaterializeScopedIndexes(scoped.scope.kind)) {
      await writeScopedIndexes(outputDir, scoped)
    }
  }

  await writeSourceFirstPlans(outputDir, workspace)
  await writeGraphKernelFiles(outputDir, workspace)
  await writeText(join(outputDir, 'state', 'corrections.jsonl'), preservedCorrectionProposals ?? '')
  await writeJsonl(join(outputDir, 'state', 'approvals.jsonl'), [])
  await writeJsonl(join(outputDir, 'state', 'notes.jsonl'), [])

  await writeJson(join(outputDir, 'runtime', 'runtime-plan.json'), workspace.plan)
  await writeJson(join(outputDir, 'runtime', 'runtime.config.json'), workspace.runtimeConfig)
  await writeJson(join(outputDir, 'runtime', 'agent-install-plan.json'), workspace.agentInstallPlan)
  for (const provider of workspace.runtimeConfig.providers) {
    await writeJson(join(outputDir, 'runtime', 'providers', `${slug(provider.name)}.json`), provider)
  }

  await writeJson(join(outputDir, 'mcp', 'server.config.json'), {
    schemaVersion: CONTEXT_RUNTIME_SCHEMA_VERSION,
    transport: 'stdio',
    manifest: '.context/manifest.json',
    tools: '.context/mcp/tools.json',
    resources: '.context/mcp/resources.json'
  })
  await writeJson(join(outputDir, 'mcp', 'tools.json'), workspace.mcpTools)
  await writeJson(join(outputDir, 'mcp', 'resources.json'), {
    schemaVersion: CONTEXT_RUNTIME_SCHEMA_VERSION,
    resources: [
      { uri: 'context://manifest', path: '.context/manifest.json', mimeType: 'application/json' },
      { uri: 'context://health', path: '.context/health.json', mimeType: 'application/json' },
      { uri: 'context://runtime-plan', path: '.context/runtime/runtime-plan.json', mimeType: 'application/json' },
      { uri: 'context://packs/project', path: '.context/packs/views/project.json', mimeType: 'application/json' },
      { uri: 'context://debug/views/project', path: '.context/debug/views/project.md', mimeType: 'text/markdown' }
    ]
  })

  for (const tool of workspace.tools) {
    await writeJson(join(outputDir, 'runtime', 'tools', `${slug(tool.name)}.json`), tool)
  }
  for (const skill of workspace.skills) {
    await writeText(join(outputDir, 'runtime', 'skills', `${slug(skill.id)}.md`), renderSkill(skill))
  }
  for (const agent of workspace.agents) {
    await writeText(join(outputDir, agent.path), agent.content)
  }
  for (const plugin of workspace.plugins) {
    await writeJson(join(outputDir, 'runtime', 'plugins', `${slug(plugin.id)}.json`), plugin)
  }

  await writeJson(join(outputDir, 'health.json'), workspace.health)
  await writeJsonl(join(outputDir, 'debug', 'diagnostics', 'latest.jsonl'), workspace.plan.diagnostics)
  await writePacks(outputDir, workspace)
  await writeDebugArtifacts(outputDir, workspace)
  await restoreGeneratedDir(preservedExtensions, join(outputDir, 'extensions'))
  await rm(preservationRoot, { recursive: true, force: true })
}

async function preserveGeneratedDir(source: string, target: string): Promise<string | undefined> {
  try {
    await mkdir(dirname(target), { recursive: true })
    await rename(source, target)
    return target
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined
    }
    throw error
  }
}

async function restoreGeneratedDir(preservedPath: string | undefined, target: string): Promise<void> {
  if (!preservedPath) {
    return
  }
  await rm(target, { recursive: true, force: true })
  await mkdir(dirname(target), { recursive: true })
  await rename(preservedPath, target)
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT')
}

async function writeSourceModelAndStore(
  outputDir: string,
  workspace: ContextRuntimeWorkspace,
  preservedGroupingDecisions?: string,
  preservedSourceCorrectionDecisions?: string
): Promise<void> {
  const entries = workspace.sourceInventory.entries
  await writeJsonl(join(outputDir, 'model', 'source-inventory.jsonl'), entries)
  await writeJsonl(
    join(outputDir, 'model', 'source-routes.jsonl'),
    entries.map((entry) => ({
      id: entry.id,
      path: entry.path,
      mediaType: entry.mediaType,
      route: entry.route,
      status: entry.status,
      sourceRef: entry.sourceRef
    }))
  )
  await writeJsonl(join(outputDir, 'model', 'unsupported-sources.jsonl'), entries.filter((entry) => entry.status === 'unsupported'))
  await writeJsonl(join(outputDir, 'model', 'groups.jsonl'), workspace.sourceInventory.groups ?? [])
  await writeJsonl(join(outputDir, 'model', 'packages.jsonl'), workspace.sourceInventory.packages ?? [])
  await writeJsonl(join(outputDir, 'model', 'build-units.jsonl'), (workspace.sourceInventory.packages ?? []).flatMap((record) => record.buildUnits))
  await writeJsonl(join(outputDir, 'model', 'scopes.jsonl'), workspace.indexes.scopes.map((scoped) => scoped.scope))
  await writeJsonl(join(outputDir, 'model', 'claims.jsonl'), [])
  if (workspace.sourceInventory.groupingRequest) {
    await writeJson(join(outputDir, 'model', 'grouping-request.json'), workspace.sourceInventory.groupingRequest)
  } else {
    await writeJson(join(outputDir, 'model', 'grouping-request.json'), {
      schemaVersion: 'context-source-grouping-request.v1',
      generatedAt: workspace.manifest.compiledAt,
      sources: []
    })
  }
  await writeText(
    join(outputDir, 'state', 'grouping-decisions.json'),
    preservedGroupingDecisions ??
      JSON.stringify(
        {
          schemaVersion: 'context-source-grouping-decisions.v1',
          generatedAt: workspace.manifest.compiledAt,
          decisions: []
        },
        null,
        2
      )
  )
  await writeText(join(outputDir, 'state', 'source-correction-decisions.jsonl'), preservedSourceCorrectionDecisions ?? '')
  await writeJson(join(outputDir, 'model', 'source-summary.json'), workspace.sourceInventory.summary)

  await mkdir(join(outputDir, 'store', 'blobs'), { recursive: true })
  await writeJsonl(join(outputDir, 'store', 'chunks.jsonl'), [])
  await writeJsonl(
    join(outputDir, 'store', 'source-map.jsonl'),
    entries.map((entry) => ({
      id: entry.id,
      sourceRef: entry.sourceRef,
      path: entry.path,
      route: entry.route,
      hash: entry.hash
    }))
  )
}

async function writePacks(outputDir: string, workspace: ContextRuntimeWorkspace): Promise<void> {
  const packs = workspace.manifest.packEntries
  const viewPacks = new Set(packs.filter((pack) => pack.view).map((pack) => pack.view as string))
  await mkdir(join(outputDir, 'packs', 'views'), { recursive: true })
  await mkdir(join(outputDir, 'packs', 'tasks'), { recursive: true })
  for (const pack of workspace.packs) {
    if (pack.kind === 'context-view' && pack.view) {
      await writeJson(join(outputDir, 'packs', 'views', `${pack.view}.json`), serializePack(pack))
      await writeText(join(outputDir, 'debug', 'views', `${pack.view}.md`), pack.content)
    } else if (pack.kind === 'task-context') {
      await writeJson(join(outputDir, 'packs', 'tasks', `${slug(pack.id)}.json`), serializePack(pack))
    }
  }
  for (const defaultView of ['project', 'implementation', 'review', 'testing']) {
    if (!viewPacks.has(defaultView)) {
      await writeJson(join(outputDir, 'packs', 'views', `${defaultView}.json`), {
        schemaVersion: 'context-pack.v1',
        id: `context-view:${defaultView}`,
        kind: 'context-view',
        view: defaultView,
        title: `${defaultView} context`,
        content: '',
        metadata: { empty: true }
      })
    }
  }
}

function serializePack(pack: ContextPack): Record<string, unknown> {
  return {
    schemaVersion: 'context-pack.v1',
    id: pack.id,
    kind: pack.kind,
    title: pack.title,
    view: pack.view,
    task: pack.task,
    content: pack.content,
    metadata: pack.metadata
  }
}

async function writeDebugArtifacts(outputDir: string, workspace: ContextRuntimeWorkspace): Promise<void> {
  await writeText(
    join(outputDir, 'debug', 'project', 'brief.md'),
    [
      `# ${workspace.manifest.project.name} Context Brief`,
      '',
      `Compiled at: ${workspace.manifest.compiledAt}`,
      '',
      '## Runtime',
      '',
      `- Nodes: ${workspace.manifest.scale.nodes}`,
      `- Edges: ${workspace.manifest.scale.edges}`,
      `- Diagnostics: ${workspace.manifest.scale.diagnostics}`,
      `- Providers: ${workspace.providers.length}`,
      '',
      '## Agent Workflow',
      '',
      '- Prefer MCP and JSON packs over scanning generated files.',
      '- Use debug Markdown only when MCP or structured packs are unavailable.',
      '- Verify code facts by reading source files before editing.'
    ].join('\n')
  )

  const domains = [...new Set(workspace.indexes.fts.map((entry) => entry.domain).filter((domain): domain is string => Boolean(domain)))].sort()
  await Promise.all(
    domains.map((domain) =>
      writeText(
        join(outputDir, 'debug', 'domains', `${slug(domain)}.md`),
        [`# ${domain} Domain Context`, '', ...workspace.indexes.fts.filter((entry) => entry.domain === domain).map((entry) => `- ${entry.id}: ${entry.name}`)].join('\n')
      )
    )
  )

  await writeText(
    join(outputDir, 'debug', 'reports', 'diagnostics.md'),
    [
      '# Context Diagnostics',
      '',
      workspace.plan.diagnostics.length === 0
        ? 'No diagnostics.'
        : workspace.plan.diagnostics.map((diagnostic) => `- [${diagnostic.severity}] ${diagnostic.type}: ${diagnostic.message}`).join('\n')
    ].join('\n')
  )
  await mkdir(join(outputDir, 'debug', 'maps', 'graphify'), { recursive: true })

  for (const scoped of workspace.indexes.scopes) {
    for (const adapter of scoped.scope.adapterRefs) {
      await writeJson(join(outputDir, 'extensions', adapterDirName(adapter.adapterId), 'artifacts', slug(scoped.scope.id), 'summary.json'), {
        schemaVersion: 'context-graph-adapter-artifact.v1',
        adapterId: adapter.adapterId,
        role: adapter.role,
        scopeId: scoped.scope.id,
        scopeKind: scoped.scope.kind,
        generatedAt: workspace.manifest.compiledAt,
        note: 'External adapter output is reserved here; v1 stores canonical graph projections and adapter metadata.'
      })
    }
  }
}

function adapterDirName(adapterId: string): string {
  return adapterId.replace(/[^A-Za-z0-9_.:-]+/g, '-')
}

async function writeSourceFirstPlans(outputDir: string, workspace: ContextRuntimeWorkspace): Promise<void> {
  await writeJson(join(outputDir, 'model', 'plans', 'planning-pack.json'), workspace.graphKernel.planningPack)
  await writeJsonl(join(outputDir, 'model', 'plans', 'planning-cycles.jsonl'), workspace.graphKernel.planningCycles)
  await writeJson(join(outputDir, 'model', 'plans', 'source-triage.json'), workspace.sourceFirstPlans.triage)
  await writeJson(join(outputDir, 'model', 'plans', 'source-group-plan.json'), workspace.sourceFirstPlans.sourceGroups)
  await writeJson(join(outputDir, 'model', 'plans', 'workspace-graph-plan.json'), workspace.sourceFirstPlans.workspaceGraph)
  await writeJson(join(outputDir, 'model', 'plans', 'scope-build-plan.json'), workspace.sourceFirstPlans.scopeBuild)
  await writeJson(join(outputDir, 'model', 'plans', 'adapter-plan.json'), workspace.sourceFirstPlans.adapterPlan)
}

async function writeGraphKernelFiles(outputDir: string, workspace: ContextRuntimeWorkspace): Promise<void> {
  await writeJsonl(join(outputDir, 'graph', 'revisions.jsonl'), workspace.graphKernel.revisions)
  await writeJsonl(join(outputDir, 'graph', 'patches.jsonl'), workspace.graphKernel.patches)
  await writeJsonl(join(outputDir, 'graph', 'evidence-reports.jsonl'), workspace.graphKernel.evidenceReports)
  await writeJsonl(join(outputDir, 'state', 'rehome-proposals.jsonl'), workspace.graphKernel.rehomeProposals)
}

async function writeGlobalIndexes(outputDir: string, workspace: ContextRuntimeWorkspace): Promise<void> {
  const dir = join(outputDir, 'index', 'global')
  await writeIndexFile(join(dir, 'graph.sqlite'), 'graph_nodes', workspace.indexes.graph)
  await writeIndexFile(join(dir, 'symbols.sqlite'), 'symbols', workspace.indexes.symbols)
  await writeIndexFile(join(dir, 'api.sqlite'), 'apis', workspace.indexes.apis)
  await writeIndexFile(join(dir, 'docs.sqlite'), 'docs', workspace.indexes.docs)
  await writeIndexFile(join(dir, 'tests.sqlite'), 'tests', workspace.indexes.tests)
  await writeIndexFile(join(dir, 'runtime.sqlite'), 'runtime', workspace.indexes.runtime)
  await writeIndexFile(join(dir, 'fts.sqlite'), 'fts', workspace.indexes.fts)
  await writeIndexFile(join(dir, 'fingerprints.sqlite'), 'fingerprints', workspace.indexes.fingerprints)
}

async function writeScopedIndexes(outputDir: string, scoped: ContextRuntimeWorkspace['indexes']['scopes'][number]): Promise<void> {
  const dir = join(outputDir, 'index', 'scopes', slug(scoped.scope.id))
  await writeIndexFile(join(dir, 'graph.sqlite'), 'graph_nodes', scoped.indexes.graph)
  await writeIndexFile(join(dir, 'symbols.sqlite'), 'symbols', scoped.indexes.symbols)
  await writeIndexFile(join(dir, 'api.sqlite'), 'apis', scoped.indexes.apis)
  await writeIndexFile(join(dir, 'docs.sqlite'), 'docs', scoped.indexes.docs)
  await writeIndexFile(join(dir, 'tests.sqlite'), 'tests', scoped.indexes.tests)
  await writeIndexFile(join(dir, 'runtime.sqlite'), 'runtime', scoped.indexes.runtime)
  await writeIndexFile(join(dir, 'fts.sqlite'), 'fts', scoped.indexes.fts)
  await writeIndexFile(join(dir, 'fingerprints.sqlite'), 'fingerprints', scoped.indexes.fingerprints)
}

function shouldMaterializeScopedIndexes(kind: ContextRuntimeWorkspace['indexes']['scopes'][number]['scope']['kind']): boolean {
  return kind === 'project' || kind === 'source_group' || kind === 'build_graph'
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

async function writeJsonl(path: string, records: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const content = records.map((record) => JSON.stringify(record)).join('\n')
  await writeFile(path, content.length > 0 ? `${content}\n` : '')
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value.endsWith('\n') ? value : `${value}\n`)
}

async function writeIndexFile(path: string, table: string, rows: readonly unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await rm(path, { force: true })
  const tableName = sqliteIdentifier(table)
  const sql = [
    'PRAGMA journal_mode=OFF;',
    'PRAGMA synchronous=OFF;',
    `CREATE TABLE ${tableName} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`,
    tableName === 'fts' ? 'CREATE VIRTUAL TABLE fts_text USING fts5(id, text);' : undefined,
    ...rows.map((row, index) => {
      const id = rowId(row, index)
      const data = JSON.stringify(row)
      return `INSERT INTO ${tableName} (id, data) VALUES (${sqliteString(id)}, ${sqliteString(data)});`
    }),
    ...(tableName === 'fts'
      ? rows.map((row, index) => `INSERT INTO fts_text (id, text) VALUES (${sqliteString(rowId(row, index))}, ${sqliteString(rowText(row))});`)
      : [])
  ].filter(Boolean).join('\n')
  await runSqlite(path, sql)
}

async function runSqlite(path: string, sql: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('sqlite3', [path], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`sqlite3 failed for ${path}: ${stderr.trim()}`))
      }
    })
    child.stdin.end(sql)
  })
}

function sqliteIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, '_') || 'rows'
}

function sqliteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function rowId(row: unknown, index: number): string {
  return isRecord(row) && typeof row.id === 'string' ? row.id : `row-${index}`
}

function rowText(row: unknown): string {
  if (isRecord(row) && typeof row.text === 'string') {
    return row.text
  }
  return JSON.stringify(row)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renderSkill(skill: ContextSkillDefinition): string {
  return [`# ${skill.title}`, '', skill.description, skill.content, ''].filter(Boolean).join('\n')
}
