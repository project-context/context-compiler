import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  applyManagedBlock,
  buildContextAgentInstallPlan,
  checkSourceFingerprints,
  compileContextProject,
  loadContextConfig,
  loadGraphFiles,
  resolveOutputDir,
  type ContextAgentInstallFile,
  type ContextAgentInstallPlan,
  type ContextAgentInstallStatus,
  type ContextAgentTarget,
  type ContextGraph,
  type ContextProjectConfig,
  type ContextRuntimeConfig,
  type ContextSourceFingerprint
} from '@context-compiler/core'
import { createLocalDistribution } from '@context-compiler/distribution-local'

/** Compile the current workspace with the official local distribution. */
export async function compileProject(cwd: string): Promise<{ graph: ContextGraph; config: ContextProjectConfig }> {
  const { config, diagnostics } = await loadContextConfig(cwd)
  const result = await compileContextProject({
    rootDir: config.workspace.rootDir,
    config,
    distribution: createLocalDistribution(),
    initialDiagnostics: diagnostics
  })
  return { graph: result.graph, config: result.config }
}

/** Read the last emitted graph and normalized context config. */
export async function readCompiledProject(cwd: string): Promise<{ graph: ContextGraph; config: ContextProjectConfig }> {
  const { config } = await loadContextConfig(cwd)
  const graph = await loadGraphFiles(resolveOutputDir(config.workspace.rootDir, config.outputDir ?? '.context'))
  return { graph, config }
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
  const path = join(outputDir, 'context-manifest.json')
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
    { type: 'markdown', name: 'product-docs', path: './docs/product' },
    { type: 'markdown', name: 'test-cases', path: './docs/tests' },
    { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
    { type: 'code', name: 'main-repo', path: './src' }
  ]
}
