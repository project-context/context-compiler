import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  AdapterRuntimeCommand,
  AdapterRuntimeEcosystem,
  AdapterRuntimeInstallPlan,
  AdapterRuntimeRequirement,
  AdapterRuntimeStatus,
  ContextProgressEvent,
  ContextProgressReporter,
  Diagnostic
} from '../contracts/index.js'

export interface ResolveAdapterRuntimeStatusOptions {
  adapterId: string
  outputDir: string
  requirement?: AdapterRuntimeRequirement
  now?: Date
}

export interface BuildAdapterRuntimeInstallPlanOptions {
  adapterId: string
  outputDir: string
  requirement?: AdapterRuntimeRequirement
}

export interface InstallManagedAdapterRuntimeOptions {
  adapterId: string
  outputDir: string
  requirement: AdapterRuntimeRequirement
  executor?: AdapterRuntimeExecutor
  pythonResolver?: AdapterRuntimePythonResolver
  onProgress?: ContextProgressReporter
  now?: Date
}

export interface EnsureAdapterRuntimeStatusOptions {
  adapterId: string
  outputDir: string
  requirement?: AdapterRuntimeRequirement
  executor?: AdapterRuntimeExecutor
  pythonResolver?: AdapterRuntimePythonResolver
  onProgress?: ContextProgressReporter
  now?: Date
}

export interface InstallManagedAdapterRuntimeResult {
  status: AdapterRuntimeStatus
  plan?: AdapterRuntimeInstallPlan
}

export interface ResolveAdapterExtensionPathsOptions {
  adapterId: string
  outputDir: string
}

export interface AdapterExtensionPaths {
  extensionDir: string
  runtimeDir: string
  dataDir: string
  artifactsDir: string
  logsDir: string
  tmpDir: string
  statusPath: string
}

export type AdapterRuntimeExecutor = (command: AdapterRuntimeCommand) => Promise<void>
export type AdapterRuntimePythonResolver = (command: string) => Promise<string | undefined>

/** Resolve the canonical owner directory for all third-party adapter data. */
export function resolveAdapterExtensionPaths(options: ResolveAdapterExtensionPathsOptions): AdapterExtensionPaths {
  const extensionDir = join(options.outputDir, 'extensions', safeSegment(options.adapterId))
  return {
    extensionDir,
    runtimeDir: join(extensionDir, 'runtime'),
    dataDir: join(extensionDir, 'data'),
    artifactsDir: join(extensionDir, 'artifacts'),
    logsDir: join(extensionDir, 'logs'),
    tmpDir: join(extensionDir, 'tmp'),
    statusPath: join(extensionDir, 'status.json')
  }
}

/** Resolve runtime status without consulting global PATH or user-level installs. */
export async function resolveAdapterRuntimeStatus(options: ResolveAdapterRuntimeStatusOptions): Promise<AdapterRuntimeStatus> {
  const requirement = options.requirement ?? { mode: 'dependency', ecosystem: 'custom' }
  if (!options.requirement) {
    return runtimeStatus(options.adapterId, requirement, 'not-required', {
      diagnostics: []
    })
  }

  if (requirement.mode === 'dependency') {
    return runtimeStatus(options.adapterId, requirement, 'available', {
      diagnostics: [],
      packageName: requirement.packageName,
      metadata: { managedBy: 'workspace-dependency' }
    })
  }

  if (requirement.mode === 'configured-runtime') {
    const configuredValue = requirement.configuredEnvVar ? process.env[requirement.configuredEnvVar] : undefined
    if (configuredValue) {
      return runtimeStatus(options.adapterId, requirement, 'available', {
        diagnostics: [],
        metadata: { configuredEnvVar: requirement.configuredEnvVar, configuredValue }
      })
    }
    return runtimeStatus(options.adapterId, requirement, 'missing', {
      diagnostics: [runtimeDiagnostic(options.adapterId, 'adapter.runtime.missing', `Adapter runtime ${options.adapterId} requires explicit configured runtime${requirement.configuredEnvVar ? ` via ${requirement.configuredEnvVar}` : ''}.`, 'error')],
      packageName: requirement.packageName
    })
  }

  const plan = buildAdapterRuntimeInstallPlan({
    adapterId: options.adapterId,
    outputDir: options.outputDir,
    requirement
  })
  if (!plan) {
    return runtimeStatus(options.adapterId, requirement, 'not-required', { diagnostics: [] })
  }

  const installed = existsSync(plan.markerPath)
  const installedAt = installed ? await readInstalledAt(plan.markerPath) : undefined
  return runtimeStatus(options.adapterId, requirement, installed ? 'installed' : 'missing', {
    diagnostics: installed
      ? []
      : [runtimeDiagnostic(options.adapterId, 'adapter.runtime.missing', `Adapter runtime ${options.adapterId} is not installed. Run: context adapters install ${options.adapterId}`, 'error')],
    packageName: requirement.packageName,
    runtimeDir: plan.runtimeDir,
    markerPath: plan.markerPath,
    installPlan: plan,
    installedAt,
    metadata: { managedBy: '.context' }
  })
}

/** Resolve an adapter runtime and automatically install missing managed runtimes. */
export async function ensureAdapterRuntimeStatus(options: EnsureAdapterRuntimeStatusOptions): Promise<AdapterRuntimeStatus> {
  const status = await resolveAdapterRuntimeStatus({
    adapterId: options.adapterId,
    outputDir: options.outputDir,
    requirement: options.requirement,
    now: options.now
  })
  if (status.state !== 'missing' || options.requirement?.mode !== 'managed-runtime') {
    return status
  }
  const installed = await installManagedAdapterRuntime({
    adapterId: options.adapterId,
    outputDir: options.outputDir,
    requirement: options.requirement,
    executor: options.executor,
    pythonResolver: options.pythonResolver,
    onProgress: options.onProgress,
    now: options.now
  })
  return installed.status
}

export function buildAdapterRuntimeInstallPlan(options: BuildAdapterRuntimeInstallPlanOptions): AdapterRuntimeInstallPlan | undefined {
  const requirement = options.requirement
  if (!requirement || requirement.mode !== 'managed-runtime') {
    return undefined
  }

  const runtimeDir = resolveRuntimeDir(options.outputDir, options.adapterId, requirement)
  const markerPath = resolveAdapterExtensionPaths({ adapterId: options.adapterId, outputDir: options.outputDir }).statusPath
  const ecosystem = requirement.ecosystem ?? 'custom'
  const commands = requirement.installCommands ?? defaultInstallCommands(runtimeDir, ecosystem, requirement)
  return {
    schemaVersion: 'context-adapter-runtime-install-plan.v1',
    adapterId: options.adapterId,
    mode: 'managed-runtime',
    ecosystem,
    packageName: requirement.packageName,
    runtimeDir,
    markerPath,
    commands,
    metadata: {
      executable: requirement.executable,
      ...requirement.metadata
    }
  }
}

export async function installManagedAdapterRuntime(options: InstallManagedAdapterRuntimeOptions): Promise<InstallManagedAdapterRuntimeResult> {
  let plan = buildAdapterRuntimeInstallPlan(options)
  if (!plan) {
    return {
      status: runtimeStatus(options.adapterId, options.requirement, 'not-required', { diagnostics: [] })
    }
  }

  const paths = resolveAdapterExtensionPaths({ adapterId: options.adapterId, outputDir: options.outputDir })
  await mkdir(plan.runtimeDir, { recursive: true })
  await mkdir(paths.logsDir, { recursive: true })
  const logPath = join(paths.logsDir, 'install.log')
  const executor = options.executor
  emitProgress(options.onProgress, {
    type: 'adapter.install.started',
    message: `Adapter runtime ${options.adapterId} install started`,
    adapterId: options.adapterId,
    metadata: {
      runtimeDir: plan.runtimeDir,
      logPath,
      commands: plan.commands.length
    }
  })
  try {
    if (shouldResolvePythonRuntime(options.requirement)) {
      const selectedPython = await resolveCompatiblePython(options.requirement, options.pythonResolver ?? defaultPythonResolver)
      plan = {
        ...plan,
        commands: defaultInstallCommands(plan.runtimeDir, plan.ecosystem, options.requirement, selectedPython.command),
        metadata: {
          ...plan.metadata,
          selectedPython: {
            command: selectedPython.command,
            version: selectedPython.version
          }
        }
      }
      emitProgress(options.onProgress, {
        type: 'adapter.install.python.selected',
        message: `Adapter runtime ${options.adapterId} selected Python ${selectedPython.command} (${selectedPython.version})`,
        adapterId: options.adapterId,
        metadata: {
          command: selectedPython.command,
          version: selectedPython.version
        }
      })
    }

    for (const command of plan.commands) {
      await appendInstallLog(logPath, `\n$ ${formatCommand(command)}\n`)
      emitProgress(options.onProgress, {
        type: 'adapter.install.command.started',
        message: `Adapter runtime ${options.adapterId} command started: ${formatCommand(command)}`,
        adapterId: options.adapterId,
        command
      })
      if (executor) {
        await executor(command)
      } else {
        await defaultExecutor(command, {
          adapterId: options.adapterId,
          onProgress: options.onProgress,
          logPath
        })
      }
      emitProgress(options.onProgress, {
        type: 'adapter.install.command.completed',
        message: `Adapter runtime ${options.adapterId} command completed: ${formatCommand(command)}`,
        adapterId: options.adapterId,
        command
      })
    }
    const installedAt = (options.now ?? new Date()).toISOString()
    await writeFile(
      plan.markerPath,
      `${JSON.stringify(
        {
          schemaVersion: 'context-adapter-runtime.v1',
          adapterId: options.adapterId,
          mode: 'managed-runtime',
          ecosystem: plan.ecosystem,
          packageName: plan.packageName,
          runtimeDir: plan.runtimeDir,
          python: plan.metadata?.selectedPython,
          installedAt
        },
        null,
        2
      )}\n`
    )
    emitProgress(options.onProgress, {
      type: 'adapter.install.completed',
      message: `Adapter runtime ${options.adapterId} install completed`,
      adapterId: options.adapterId,
      metadata: {
        runtimeDir: plan.runtimeDir,
        markerPath: plan.markerPath,
        logPath
      }
    })
    return {
      plan,
      status: runtimeStatus(options.adapterId, options.requirement, 'installed', {
        diagnostics: [],
        packageName: options.requirement.packageName,
        runtimeDir: plan.runtimeDir,
        markerPath: plan.markerPath,
        installPlan: plan,
        installedAt,
        metadata: { managedBy: '.context', selectedPython: plan.metadata?.selectedPython }
      })
    }
  } catch (error) {
    await appendInstallLog(logPath, `\n! ${error instanceof Error ? error.message : String(error)}\n`)
    emitProgress(options.onProgress, {
      type: 'adapter.install.failed',
      message: `Adapter runtime ${options.adapterId} install failed: ${error instanceof Error ? error.message : String(error)}`,
      adapterId: options.adapterId,
      metadata: {
        runtimeDir: plan.runtimeDir,
        markerPath: plan.markerPath,
        logPath
      }
    })
    return {
      plan,
      status: runtimeStatus(options.adapterId, options.requirement, 'install-failed', {
        diagnostics: [
          runtimeDiagnostic(
            options.adapterId,
            'adapter.runtime.install-failed',
            `Adapter runtime ${options.adapterId} install failed: ${error instanceof Error ? error.message : String(error)}`,
            'error'
          )
        ],
        packageName: options.requirement.packageName,
        runtimeDir: plan.runtimeDir,
        markerPath: plan.markerPath,
        installPlan: plan,
        metadata: { managedBy: '.context' }
      })
    }
  }
}

export function adapterRuntimeDiagnostic(adapterId: string, type: string, message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic {
  return runtimeDiagnostic(adapterId, type, message, severity)
}

function runtimeStatus(
  adapterId: string,
  requirement: AdapterRuntimeRequirement,
  state: AdapterRuntimeStatus['state'],
  extra: Partial<Omit<AdapterRuntimeStatus, 'schemaVersion' | 'adapterId' | 'mode' | 'state' | 'requirement'>>
): AdapterRuntimeStatus {
  return {
    schemaVersion: 'context-adapter-runtime-status.v1',
    adapterId,
    mode: requirement.mode,
    state,
    requirement,
    diagnostics: extra.diagnostics ?? [],
    packageName: extra.packageName,
    runtimeDir: extra.runtimeDir,
    markerPath: extra.markerPath,
    installedAt: extra.installedAt,
    installPlan: extra.installPlan,
    metadata: extra.metadata
  }
}

function resolveRuntimeDir(outputDir: string, adapterId: string, requirement: AdapterRuntimeRequirement): string {
  if (!requirement.runtimeDir) {
    return resolveAdapterExtensionPaths({ adapterId, outputDir }).runtimeDir
  }
  if (isAbsolute(requirement.runtimeDir)) {
    return requirement.runtimeDir
  }
  if (requirement.runtimeDir.startsWith('.context/')) {
    return join(outputDir, requirement.runtimeDir.slice('.context/'.length))
  }
  return resolve(outputDir, requirement.runtimeDir)
}

function defaultInstallCommands(
  runtimeDir: string,
  ecosystem: AdapterRuntimeEcosystem,
  requirement: AdapterRuntimeRequirement,
  pythonCommand = requirement.python?.candidates?.[0] ?? 'python3'
): AdapterRuntimeCommand[] {
  if (ecosystem !== 'python') {
    return []
  }
  const venvDir = join(runtimeDir, '.venv')
  const binDir = process.platform === 'win32' ? 'Scripts' : 'bin'
  const pythonPath = join(venvDir, binDir, process.platform === 'win32' ? 'python.exe' : 'python')
  const packageName = requirement.packageName
  return [
    { command: pythonCommand, args: ['-m', 'venv', '--clear', venvDir] },
    { command: pythonPath, args: ['-m', 'pip', 'install', '--upgrade', 'pip', ...(packageName ? [packageName] : [])] }
  ]
}

function shouldResolvePythonRuntime(requirement: AdapterRuntimeRequirement): boolean {
  return requirement.mode === 'managed-runtime' && requirement.ecosystem === 'python' && !requirement.installCommands
}

async function resolveCompatiblePython(
  requirement: AdapterRuntimeRequirement,
  resolver: AdapterRuntimePythonResolver
): Promise<{ command: string; version: string }> {
  const candidates = requirement.python?.candidates?.length ? requirement.python.candidates : ['python3', 'python']
  const attempts: string[] = []
  for (const command of candidates) {
    const detected = await resolver(command)
    if (!detected) {
      attempts.push(`${command}: not found`)
      continue
    }
    const version = parsePythonVersion(detected)
    if (!version) {
      attempts.push(`${command}: invalid version "${detected}"`)
      continue
    }
    if (!pythonVersionSatisfies(version, requirement.python)) {
      attempts.push(`${command}: ${formatVersion(version)} outside ${formatPythonRange(requirement.python)}`)
      continue
    }
    return { command, version: formatVersion(version) }
  }
  throw new Error(`No compatible Python interpreter found for ${formatPythonRange(requirement.python)}. Tried: ${attempts.join('; ')}`)
}

async function defaultPythonResolver(command: string): Promise<string | undefined> {
  return new Promise((resolveVersion) => {
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('error', () => {
      resolveVersion(undefined)
    })
    child.on('close', (code) => {
      resolveVersion(code === 0 ? output.trim() : undefined)
    })
  })
}

function parsePythonVersion(value: string): [number, number, number] | undefined {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) {
    return undefined
  }
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

function pythonVersionSatisfies(version: [number, number, number], requirement: AdapterRuntimeRequirement['python']): boolean {
  if (requirement?.minVersion && compareVersions(version, parseRequiredVersion(requirement.minVersion)) < 0) {
    return false
  }
  if (requirement?.maxVersionExclusive && compareVersions(version, parseRequiredVersion(requirement.maxVersionExclusive)) >= 0) {
    return false
  }
  return true
}

function parseRequiredVersion(value: string): [number, number, number] {
  const parsed = parsePythonVersion(value)
  if (!parsed) {
    throw new Error(`Invalid Python version requirement: ${value}`)
  }
  return parsed
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }
  return 0
}

function formatVersion(version: [number, number, number]): string {
  return `${version[0]}.${version[1]}.${version[2]}`
}

function formatPythonRange(requirement: AdapterRuntimeRequirement['python']): string {
  const parts = [
    requirement?.minVersion ? `>=${requirement.minVersion}` : undefined,
    requirement?.maxVersionExclusive ? `<${requirement.maxVersionExclusive}` : undefined
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(',') : 'any Python version'
}

async function defaultExecutor(
  command: AdapterRuntimeCommand,
  options: {
    adapterId: string
    onProgress?: ContextProgressReporter
    logPath: string
  }
): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env ? { ...process.env, ...command.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const writes: Array<Promise<void>> = []

    child.stdout?.on('data', (chunk: Buffer) => {
      const message = chunk.toString()
      writes.push(appendInstallLog(options.logPath, message))
      emitProgress(options.onProgress, {
        type: 'adapter.install.stdout',
        message,
        adapterId: options.adapterId,
        command,
        stream: 'stdout'
      })
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString()
      writes.push(appendInstallLog(options.logPath, message))
      emitProgress(options.onProgress, {
        type: 'adapter.install.stderr',
        message,
        adapterId: options.adapterId,
        command,
        stream: 'stderr'
      })
    })
    child.on('error', (error) => {
      rejectCommand(error)
    })
    child.on('close', (code, signal) => {
      void Promise.all(writes).then(() => {
        if (code === 0) {
          resolveCommand()
          return
        }
        rejectCommand(new Error(`Command failed (${formatCommand(command)}): ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}`))
      }, rejectCommand)
    })
  })
}

function emitProgress(reporter: ContextProgressReporter | undefined, event: Omit<ContextProgressEvent, 'schemaVersion' | 'timestamp'>): void {
  reporter?.({
    schemaVersion: 'context-progress-event.v1',
    timestamp: new Date().toISOString(),
    ...event
  })
}

async function appendInstallLog(logPath: string, content: string): Promise<void> {
  await appendFile(logPath, content)
}

function formatCommand(command: AdapterRuntimeCommand): string {
  return [command.command, ...command.args].join(' ')
}

async function readInstalledAt(markerPath: string): Promise<string | undefined> {
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { installedAt?: string }
    return marker.installedAt
  } catch {
    return undefined
  }
}

function runtimeDiagnostic(adapterId: string, type: string, message: string, severity: Diagnostic['severity']): Diagnostic {
  return {
    id: `DIAG-${type}-${safeSegment(adapterId)}`,
    type,
    severity,
    message,
    relatedNodes: [],
    evidence: [],
    createdAt: new Date().toISOString(),
    properties: { adapterId }
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-|-$/g, '') || 'adapter'
}
