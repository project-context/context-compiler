import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { compileContextProject } from '@context-compiler/core/compiler'
import { applyManagedBlock, applySubmittedGraphPatches, buildContextAgentInstallPlan, checkSourceFingerprints } from '@context-compiler/core/runtime'
import { loadGraphFiles, resolveOutputDir } from '@context-compiler/core/graph'
import { installManagedAdapterRuntime, loadContextConfig, resolveAdapterRuntimeStatus, type AdapterRuntimeStatus, type ContextExtensionAdapterKind, type DocumentExtractorAdapterManifest, type GraphAdapterManifest, type ContextAgentInstallFile, type ContextAgentInstallPlan, type ContextAgentInstallStatus, type ContextAgentTarget, type ContextGraph, type ContextProgressEvent, type ContextProgressReporter, type ContextProjectConfig, type ContextRuntimeConfig, type ContextSourceFingerprint } from '@context-compiler/core/sdk'
import { createBuiltinLocalDistribution } from '@context-compiler/builtin-local'

type RuntimeAdapterManifest = GraphAdapterManifest | DocumentExtractorAdapterManifest

export interface ProjectAdapterRuntimeEntry {
  kind: ContextExtensionAdapterKind
  id: string
  title: string
  manifest: RuntimeAdapterManifest
  status: AdapterRuntimeStatus
}

export interface ProjectAdapterRuntimeInstallResult {
  entries: ProjectAdapterRuntimeEntry[]
}

export interface ProjectProgressOptions {
  onProgress?: ContextProgressReporter
}

/** Compile the current workspace with the official local distribution. */
export async function compileProject(cwd: string, options: ProjectProgressOptions = {}): Promise<{ graph: ContextGraph; config: ContextProjectConfig }> {
  const { config, diagnostics } = await loadContextConfig(cwd)
  const result = await compileContextProject({
    rootDir: config.workspace.rootDir,
    config,
    distribution: createBuiltinLocalDistribution(),
    initialDiagnostics: diagnostics,
    onProgress: options.onProgress
  })
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`Compile failed with ${errors.length} error diagnostic(s): ${errors[0].message}`)
  }
  return { graph: result.graph, config: result.config }
}

/** Read the last emitted graph and normalized context config. */
export async function readCompiledProject(cwd: string): Promise<{ graph: ContextGraph; config: ContextProjectConfig }> {
  const { config } = await loadContextConfig(cwd)
  const graph = await loadGraphFiles(resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context'))
  return { graph, config }
}

/** Apply submitted GraphPatch proposals through the Graph Kernel. */
export async function applySubmittedPatchesProject(cwd: string, options: { dryRun?: boolean } = {}) {
  const { config } = await loadContextConfig(cwd)
  return applySubmittedGraphPatches({ config, dryRun: options.dryRun })
}

/** Write a minimal default context config. The local distribution plans pipelines from sources. */
export async function writeInitialConfig(cwd: string): Promise<void> {
  await writeFile(join(cwd, 'context.config.json'), `${JSON.stringify(INITIAL_CONFIG, null, 2)}\n`)
}

/** Write a parser-ready source manifest for the current local sources. */
export async function syncProject(cwd: string): Promise<number> {
  const { config } = await loadContextConfig(cwd)
  const outputDir = resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context')
  await mkdir(join(outputDir, 'connectors'), { recursive: true })
  await writeFile(join(outputDir, 'connectors', 'sources.json'), JSON.stringify({
    workspace: config.workspace,
    syncedAt: new Date().toISOString(),
    sources: config.sources,
    diagnostics: []
  }, null, 2))
  return config.sources.length
}

/** List adapter runtime status for the official local distribution in this project. */
export async function listAdapterRuntimesProject(cwd: string): Promise<ProjectAdapterRuntimeEntry[]> {
  const { config } = await loadContextConfig(cwd)
  const outputDir = resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context')
  const distribution = createBuiltinLocalDistribution()
  const manifests = collectAdapterManifests(distribution)
  const entries: ProjectAdapterRuntimeEntry[] = []
  for (const adapter of manifests) {
    entries.push({
      ...adapter,
      status: await resolveAdapterRuntimeStatus({
        adapterId: adapter.id,
        outputDir,
        requirement: adapter.manifest.runtime
      })
    })
  }
  return entries
}

/** Install managed adapter runtimes explicitly under `.context/extensions/<adapter-id>/runtime`. */
export async function installAdapterRuntimesProject(
  cwd: string,
  adapterId?: string,
  options: ProjectProgressOptions = {}
): Promise<ProjectAdapterRuntimeInstallResult> {
  const { config } = await loadContextConfig(cwd)
  const outputDir = resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context')
  const distribution = createBuiltinLocalDistribution()
  const selected = collectAdapterManifests(distribution).filter((adapter) => !adapterId || adapter.id === adapterId)
  if (selected.length === 0) {
    throw new Error(`Unknown adapter runtime: ${adapterId}`)
  }

  emitProjectProgress(options.onProgress, {
    type: 'adapter.install.batch.started',
    message: `Adapter runtime install batch started (${selected.length} adapter${selected.length === 1 ? '' : 's'})`,
    metadata: { adapters: selected.length }
  })
  const entries: ProjectAdapterRuntimeEntry[] = []
  for (const adapter of selected) {
    emitProjectProgress(options.onProgress, {
      type: 'adapter.install.adapter.started',
      message: `Adapter runtime ${adapter.id} check started`,
      adapterId: adapter.id,
      metadata: { kind: adapter.kind, mode: adapter.manifest.runtime?.mode ?? 'not-required' }
    })
    const initial = await resolveAdapterRuntimeStatus({
      adapterId: adapter.id,
      outputDir,
      requirement: adapter.manifest.runtime
    })
    if (adapter.manifest.runtime?.mode !== 'managed-runtime') {
      emitProjectProgress(options.onProgress, {
        type: 'adapter.install.skipped',
        message: `Adapter runtime ${adapter.id} does not require managed install`,
        adapterId: adapter.id,
        metadata: { kind: adapter.kind, mode: adapter.manifest.runtime?.mode ?? 'not-required' }
      })
      entries.push({
        ...adapter,
        status: { ...initial, state: 'not-required', diagnostics: [] }
      })
      continue
    }
    const installed = await installManagedAdapterRuntime({
      adapterId: adapter.id,
      outputDir,
      requirement: adapter.manifest.runtime,
      onProgress: options.onProgress
    })
    entries.push({
      ...adapter,
      status: installed.status
    })
  }
  emitProjectProgress(options.onProgress, {
    type: 'adapter.install.batch.completed',
    message: `Adapter runtime install batch completed (${entries.length} adapter${entries.length === 1 ? '' : 's'})`,
    metadata: { adapters: entries.length }
  })
  return { entries }
}

/** Install repo-native Codex and Claude Code integration files. */
export async function integrateProject(cwd: string, target: ContextAgentTarget): Promise<ContextAgentInstallPlan> {
  const { config } = await loadContextConfig(cwd)
  const outputDir = resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context')
  const runtimeConfig = await readRuntimeConfig(outputDir)
  const plan = buildContextAgentInstallPlan(config, runtimeConfig, { target })
  const installedFiles: ContextAgentInstallFile[] = []
  for (const file of plan.files) {
    await applyInstallFile(config.workspace.rootDir, file)
    installedFiles.push(await markInstallFile(config.workspace.rootDir, file, 'installed'))
  }
  const installedPlan: ContextAgentInstallPlan = {
    ...plan,
    files: installedFiles,
    metadata: {
      ...plan.metadata,
      installStatus: installStatusForAgents(plan.targetAgents, installedFiles)
    }
  }
  await writeInstalledAgentPlan(outputDir, installedPlan)
  await updateManifestInstallStatus(outputDir, installedPlan)
  return installedPlan
}

export interface RuntimeFreshnessReport {
  status: 'fresh' | 'stale' | 'unknown'
  staleSources: string[]
}

/** Check whether the latest runtime summary still matches current source files. */
export async function readRuntimeFreshness(cwd: string, config: ContextProjectConfig): Promise<RuntimeFreshnessReport> {
  const summary = await readOptionalFile(contextPath(cwd, config, 'runtime', 'run-summary.json'))
  if (!summary) {
    return { status: 'unknown', staleSources: [] }
  }
  const parsed = JSON.parse(summary) as { sourceFingerprints?: ContextSourceFingerprint[] }
  const fingerprints = parsed.sourceFingerprints ?? []
  const result = await checkSourceFingerprints(config.workspace.rootDir, fingerprints)
  return {
    status: result.status,
    staleSources: result.stale.map((fingerprint) => fingerprint.source.uri.replace(/^file:\/\//, ''))
  }
}

/** Read a text file if it exists. */
export async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Resolve a path inside the emitted context directory. */
export function contextPath(cwd: string, config: ContextProjectConfig, ...parts: string[]): string {
  return resolve(resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context'), ...parts)
}

async function readRuntimeConfig(outputDir: string): Promise<ContextRuntimeConfig> {
  const content = await readOptionalFile(resolve(outputDir, 'runtime', 'runtime.config.json'))
  return content ? (JSON.parse(content) as ContextRuntimeConfig) : {}
}

function collectAdapterManifests(distribution: ReturnType<typeof createBuiltinLocalDistribution>): Array<{
  kind: ContextExtensionAdapterKind
  id: string
  title: string
  manifest: RuntimeAdapterManifest
}> {
  const manifests = [
    ...(distribution.graphAdapters ?? []).map((adapter) => ({ kind: 'graph-adapter' as const, id: adapter.manifest.id, title: adapter.manifest.title, manifest: adapter.manifest })),
    ...(distribution.documentExtractors ?? []).map((adapter) => ({ kind: 'document-extractor' as const, id: adapter.manifest.id, title: adapter.manifest.title, manifest: adapter.manifest }))
  ]
  const seen = new Set<string>()
  return manifests.filter((entry) => {
    if (seen.has(entry.id)) {
      return false
    }
    seen.add(entry.id)
    return true
  })
}

function emitProjectProgress(reporter: ContextProgressReporter | undefined, event: Omit<ContextProgressEvent, 'schemaVersion' | 'timestamp'>): void {
  reporter?.({
    schemaVersion: 'context-progress-event.v1',
    timestamp: new Date().toISOString(),
    ...event
  })
}

async function applyInstallFile(rootDir: string, file: ContextAgentInstallFile): Promise<void> {
  const path = resolve(rootDir, file.path)
  await mkdir(dirname(path), { recursive: true })

  if (file.mode === 'managed-block') {
    const existing = await readOptionalFile(path) ?? ''
    await writeFile(path, applyManagedBlock(existing, requiredMarker(file), file.content))
    return
  }

  if (file.mode === 'merge-json') {
    const existing = parseJsonObject(await readOptionalFile(path))
    const incoming = parseJsonObject(file.content)
    await writeFile(path, `${JSON.stringify(mergeObjects(existing, incoming), null, 2)}\n`)
    return
  }

  await writeFile(path, file.content.endsWith('\n') ? file.content : `${file.content}\n`)
}

async function markInstallFile(
  rootDir: string,
  file: ContextAgentInstallFile,
  status: ContextAgentInstallStatus
): Promise<ContextAgentInstallFile> {
  const path = resolve(rootDir, file.path)
  const content = await readOptionalFile(path)
  return {
    ...file,
    status,
    detected: {
      exists: content !== undefined,
      hasManagedBlock: file.marker ? content?.includes(`<!-- BEGIN ${file.marker} -->`) ?? false : undefined,
      contentMatches: content === undefined ? false : detectedContentMatches(file, content)
    }
  }
}

function detectedContentMatches(file: ContextAgentInstallFile, content: string): boolean {
  if (file.mode === 'managed-block') {
    return file.marker ? content.includes(file.content.trim()) : false
  }
  if (file.mode === 'merge-json') {
    return true
  }
  return content.trimEnd() === file.content.trimEnd()
}

function installStatusForAgents(
  agents: ContextAgentInstallPlan['targetAgents'],
  files: ContextAgentInstallFile[]
): Record<string, ContextAgentInstallStatus> {
  return Object.fromEntries(
    agents.map((agent) => {
      const agentFiles = files.filter((file) => file.agent === agent)
      const status = agentFiles.length > 0 && agentFiles.every((file) => file.status === 'installed') ? 'installed' : 'stale'
      return [agent, status]
    })
  )
}

async function writeInstalledAgentPlan(outputDir: string, plan: ContextAgentInstallPlan): Promise<void> {
  await mkdir(join(outputDir, 'runtime'), { recursive: true })
  await writeFile(join(outputDir, 'runtime', 'agent-install-plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
}

async function updateManifestInstallStatus(outputDir: string, plan: ContextAgentInstallPlan): Promise<void> {
  await updateOneManifestInstallStatus(join(outputDir, 'manifest.json'), plan)
}

async function updateOneManifestInstallStatus(path: string, plan: ContextAgentInstallPlan): Promise<void> {
  const content = await readOptionalFile(path)
  if (!content) {
    return
  }
  const manifest = JSON.parse(content) as {
    runtime?: {
      installStatus?: Record<string, ContextAgentInstallStatus>
    }
  }
  manifest.runtime ??= {}
  manifest.runtime.installStatus ??= {}
  for (const [agent, status] of Object.entries(installStatusForAgents(plan.targetAgents, plan.files))) {
    manifest.runtime.installStatus[agent] = status
  }
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function requiredMarker(file: ContextAgentInstallFile): string {
  if (!file.marker) {
    throw new Error(`Managed block file is missing marker: ${file.path}`)
  }
  return file.marker
}

function parseJsonObject(content: string | undefined): Record<string, unknown> {
  if (!content || content.trim().length === 0) {
    return {}
  }
  const parsed = JSON.parse(content) as unknown
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

function mergeObjects(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...left }
  for (const [key, value] of Object.entries(right)) {
    const existing = merged[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeObjects(existing, value)
    } else {
      merged[key] = value
    }
  }
  return merged
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const INITIAL_CONFIG = {
  sources: [
    { name: 'workspace', path: './sources' }
  ]
}
