import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildAdapterRuntimeInstallPlan,
  ensureAdapterRuntimeStatus,
  installManagedAdapterRuntime,
  resolveAdapterRuntimeStatus,
  resolveAdapterExtensionPaths,
  validateGraphAdapterManifest,
  type AdapterRuntimeCommand,
  type ContextProgressEvent,
  type GraphAdapterManifest
} from '@context-compiler/core'

const outputDir = (rootDir: string) => join(rootDir, '.context')

describe('adapter runtime manager', () => {
  it('resolves all third-party-owned data under .context/extensions/<adapter-id>', () => {
    const paths = resolveAdapterExtensionPaths({
      adapterId: 'codegraph.graph-adapter',
      outputDir: '/repo/.context'
    })

    expect(paths).toEqual({
      extensionDir: '/repo/.context/extensions/codegraph.graph-adapter',
      runtimeDir: '/repo/.context/extensions/codegraph.graph-adapter/runtime',
      dataDir: '/repo/.context/extensions/codegraph.graph-adapter/data',
      artifactsDir: '/repo/.context/extensions/codegraph.graph-adapter/artifacts',
      logsDir: '/repo/.context/extensions/codegraph.graph-adapter/logs',
      tmpDir: '/repo/.context/extensions/codegraph.graph-adapter/tmp',
      statusPath: '/repo/.context/extensions/codegraph.graph-adapter/status.json'
    })
  })

  it('treats TypeScript SDK adapters as dependency runtimes without generating an install plan', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-sdk-'))
    const status = await resolveAdapterRuntimeStatus({
      adapterId: 'codegraph.graph-adapter',
      outputDir: outputDir(rootDir),
      requirement: {
        mode: 'dependency',
        ecosystem: 'node',
        packageName: '@colbymchenry/codegraph'
      }
    })

    expect(status).toMatchObject({
      adapterId: 'codegraph.graph-adapter',
      mode: 'dependency',
      state: 'available',
      packageName: '@colbymchenry/codegraph'
    })
    expect(buildAdapterRuntimeInstallPlan({
      adapterId: 'codegraph.graph-adapter',
      outputDir: outputDir(rootDir),
      requirement: status.requirement
    })).toBeUndefined()
  })

  it('resolves managed Python runtimes only under .context and never accepts global PATH as installed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-managed-'))
    const status = await resolveAdapterRuntimeStatus({
      adapterId: 'microsoft-graphrag.graph-adapter',
      outputDir: outputDir(rootDir),
      requirement: {
        mode: 'managed-runtime',
        ecosystem: 'python',
        packageName: 'graphrag',
        executable: 'graphrag'
      }
    })

    expect(status.state).toBe('missing')
    expect(status.runtimeDir).toBe(join(rootDir, '.context', 'extensions', 'microsoft-graphrag.graph-adapter', 'runtime'))
    expect(status.markerPath).toBe(join(rootDir, '.context', 'extensions', 'microsoft-graphrag.graph-adapter', 'status.json'))
    expect(status.diagnostics).toEqual([
      expect.objectContaining({
        type: 'adapter.runtime.missing',
        severity: 'error',
        message: expect.stringContaining('context adapters install microsoft-graphrag.graph-adapter')
      })
    ])
  })

  it('installs a managed runtime through injected commands and writes an installed marker', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-install-'))
    const commands: AdapterRuntimeCommand[] = []
    const result = await installManagedAdapterRuntime({
      adapterId: 'docling.document-extractor',
      outputDir: outputDir(rootDir),
      requirement: {
        mode: 'managed-runtime',
        ecosystem: 'python',
        packageName: 'docling',
        executable: 'docling'
      },
      pythonResolver: async () => '3.12.0',
      executor: async (command) => {
        commands.push(command)
      }
    })

    expect(result.status.state).toBe('installed')
    expect(commands.map((command) => [command.command, command.args])).toEqual([
      ['python3', ['-m', 'venv', '--clear', join(rootDir, '.context', 'extensions', 'docling.document-extractor', 'runtime', '.venv')]],
      [
        join(rootDir, '.context', 'extensions', 'docling.document-extractor', 'runtime', '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'),
        ['-m', 'pip', 'install', '--upgrade', 'pip', 'docling']
      ]
    ])
    await expect(readFile(join(rootDir, '.context', 'extensions', 'docling.document-extractor', 'status.json'), 'utf8')).resolves.toContain('docling.document-extractor')
  })

  it('ensures a missing managed runtime by installing it before returning status', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-ensure-'))
    const commands: AdapterRuntimeCommand[] = []
    const status = await ensureAdapterRuntimeStatus({
      adapterId: 'marker.graph-adapter',
      outputDir: outputDir(rootDir),
      requirement: {
        mode: 'managed-runtime',
        ecosystem: 'custom',
        packageName: 'marker',
        executable: 'marker',
        installCommands: [
          { command: process.execPath, args: ['-e', ''] }
        ]
      },
      executor: async (command) => {
        commands.push(command)
      }
    })

    expect(status).toMatchObject({
      adapterId: 'marker.graph-adapter',
      state: 'installed',
      runtimeDir: join(rootDir, '.context', 'extensions', 'marker.graph-adapter', 'runtime')
    })
    expect(commands).toEqual([
      { command: process.execPath, args: ['-e', ''] }
    ])
    await expect(readFile(join(rootDir, '.context', 'extensions', 'marker.graph-adapter', 'status.json'), 'utf8')).resolves.toContain('marker.graph-adapter')
  })

  it('selects a compatible Python interpreter for managed runtimes with a version range', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-python-select-'))
    const commands: AdapterRuntimeCommand[] = []
    const result = await installManagedAdapterRuntime({
      adapterId: 'microsoft-graphrag.graph-adapter',
      outputDir: outputDir(rootDir),
      requirement: {
        mode: 'managed-runtime',
        ecosystem: 'python',
        packageName: 'graphrag',
        executable: 'graphrag',
        python: {
          candidates: ['python3.13', 'python3'],
          minVersion: '3.11',
          maxVersionExclusive: '3.14'
        }
      },
      pythonResolver: async (command) => command === 'python3.13' ? '3.13.7' : '3.14.0',
      executor: async (command) => {
        commands.push(command)
      }
    })

    expect(result.status.state).toBe('installed')
    expect(commands.map((command) => [command.command, command.args])).toEqual([
      ['python3.13', ['-m', 'venv', '--clear', join(rootDir, '.context', 'extensions', 'microsoft-graphrag.graph-adapter', 'runtime', '.venv')]],
      [
        join(rootDir, '.context', 'extensions', 'microsoft-graphrag.graph-adapter', 'runtime', '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'),
        ['-m', 'pip', 'install', '--upgrade', 'pip', 'graphrag']
      ]
    ])
  })

  it('fails before creating a venv when no compatible Python interpreter is available', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-python-missing-'))
    const commands: AdapterRuntimeCommand[] = []
    const result = await installManagedAdapterRuntime({
      adapterId: 'microsoft-graphrag.graph-adapter',
      outputDir: outputDir(rootDir),
      requirement: {
        mode: 'managed-runtime',
        ecosystem: 'python',
        packageName: 'graphrag',
        executable: 'graphrag',
        python: {
          candidates: ['python3.13', 'python3'],
          minVersion: '3.11',
          maxVersionExclusive: '3.14'
        }
      },
      pythonResolver: async (command) => command === 'python3' ? '3.14.0' : undefined,
      executor: async (command) => {
        commands.push(command)
      }
    })

    expect(result.status.state).toBe('install-failed')
    expect(commands).toEqual([])
    expect(result.status.diagnostics[0]?.message).toContain('No compatible Python interpreter found')
    expect(result.status.diagnostics[0]?.message).toContain('>=3.11,<3.14')
  })

  it('streams managed install progress and writes command logs under the adapter extension', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-install-progress-'))
    const events: ContextProgressEvent[] = []
    const result = await installManagedAdapterRuntime({
      adapterId: 'docling.document-extractor',
      outputDir: outputDir(rootDir),
      requirement: {
        mode: 'managed-runtime',
        ecosystem: 'python',
        packageName: 'docling',
        executable: 'docling',
        installCommands: [
          { command: 'python3', args: ['-m', 'venv', '<runtime>'] },
          { command: 'python', args: ['-m', 'pip', 'install', 'docling'] }
        ]
      },
      executor: async () => {},
      onProgress: (event) => events.push(event)
    })

    expect(result.status.state).toBe('installed')
    expect(events.map((event) => event.type)).toEqual([
      'adapter.install.started',
      'adapter.install.command.started',
      'adapter.install.command.completed',
      'adapter.install.command.started',
      'adapter.install.command.completed',
      'adapter.install.completed'
    ])
    await expect(readFile(join(rootDir, '.context', 'extensions', 'docling.document-extractor', 'logs', 'install.log'), 'utf8')).resolves.toContain(
      '$ python3 -m venv <runtime>'
    )
  })

  it('validates runtime requirements in graph adapter manifests', () => {
    const manifest: GraphAdapterManifest = {
      id: 'microsoft-graphrag.graph-adapter',
      title: 'Microsoft GraphRAG',
      version: '0.1.0',
      scopeKinds: ['source_group'],
      sourceGroupKinds: ['doc_bundle'],
      inputs: ['ParsedArtifact'],
      outputs: ['Document'],
      deterministic: false,
      requiresNetwork: true,
      stability: 'development',
      runtime: {
        mode: 'managed-runtime',
        ecosystem: 'python',
        packageName: 'graphrag',
        executable: 'graphrag'
      }
    }

    expect(validateGraphAdapterManifest(manifest)).toEqual([])
    expect(validateGraphAdapterManifest({ ...manifest, runtime: { mode: 'dependency', ecosystem: 'node' } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'adapter.runtime.invalid-manifest' })])
    )
  })
})
