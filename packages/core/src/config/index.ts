import { access, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'
import type { ContextConfigInput, ContextProjectConfig } from '../contracts/config.js'
import type { Diagnostic } from '../contracts/graph.js'

export type {
  ContextConfigInput,
  ContextProjectConfig,
  SourceConfig,
  SourceLocation,
  SourceRef,
  WorkspaceMetadata
} from '../contracts/config.js'

/** Loaded context config plus the path it came from. */
export interface LoadedContextConfig {
  config: ContextProjectConfig
  path: string
  diagnostics: Diagnostic[]
}

export interface DefineContextProjectOptions {
  rootDir?: string
  configPath?: string
}

/** Normalize a user config and apply stable defaults. */
export function defineContextProject(
  input: ContextProjectConfig | ContextConfigInput = {},
  options: DefineContextProjectOptions = {}
): ContextProjectConfig {
  if ('workspace' in input && input.workspace) {
    return {
      workspace: input.workspace,
      sources: input.sources ?? [],
      components: input.components ?? {},
      pipelines: input.pipelines ?? {},
      policies: input.policies ?? {},
      outputDir: input.outputDir
    }
  }

  const rootDir = resolve(options.rootDir ?? process.cwd())
  return {
    workspace: {
      rootDir,
      name: basename(rootDir) || 'workspace',
      configPath: options.configPath
    },
    sources: input.sources ?? [],
    components: input.components ?? {},
    pipelines: input.pipelines ?? {},
    policies: input.policies ?? {},
    outputDir: input.outputDir
  }
}

/** Load JSON or ESM context config from a workspace root. */
export async function loadContextConfig(rootDir: string): Promise<LoadedContextConfig> {
  const path = await findConfigPath(rootDir)
  const configRoot = dirname(path)
  if (path.endsWith('.json')) {
    const input = JSON.parse(await readFile(path, 'utf8')) as ContextConfigInput
    return {
      path,
      config: defineContextProject(input, {
        rootDir: configRoot,
        configPath: path
      }),
      diagnostics: []
    }
  }

  const imported = await import(`${pathToFileURL(path).href}?t=${Date.now()}`) as { default?: ContextConfigInput }
  const input = imported.default ?? {}
  return {
    path,
    config: defineContextProject(input, {
      rootDir: configRoot,
      configPath: path
    }),
    diagnostics: []
  }
}

async function findConfigPath(rootDir: string): Promise<string> {
  const candidates = ['context.config.json', 'context.config.mjs', 'context.config.js']
  for (const candidate of candidates) {
    const path = join(rootDir, candidate)
    try {
      await access(path)
      return path
    } catch {
      // Try the next supported config filename.
    }
  }
  throw new Error(`No context.config.json found in ${rootDir}`)
}
