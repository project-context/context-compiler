import { existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const SourceConfigSchema = z
  .object({
    type: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1)
  })
  .passthrough()

export const RoleConfigSchema = z
  .object({
    include: z.array(z.string()).default(['*']),
    diagnostics: z.boolean().optional()
  })
  .passthrough()

export const ContextProjectConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    domains: z.array(z.string()).default([]),
    defaultLanguage: z.string().default('zh-CN')
  }),
  sources: z.array(SourceConfigSchema).default([]),
  roles: z.record(RoleConfigSchema).default({}),
  codeIndex: z
    .object({
      languages: z.union([z.literal('auto'), z.array(z.string())]).default('auto'),
      providers: z.array(z.string()).default(['tree-sitter', 'ctags']),
      fallbackProvider: z.string().default('ctags'),
      deepAnalysisProviders: z.array(z.string()).default([])
    })
    .optional(),
  policies: z.record(z.unknown()).optional(),
  emitters: z.array(z.record(z.unknown())).optional()
})

export type SourceConfig = z.infer<typeof SourceConfigSchema>
export type RoleConfig = z.infer<typeof RoleConfigSchema>
export type ContextProjectConfig = z.infer<typeof ContextProjectConfigSchema>

export interface LoadedContextConfig {
  config: ContextProjectConfig
  path: string
}

export function defineContextProject(input: unknown): ContextProjectConfig {
  return ContextProjectConfigSchema.parse(input)
}

export async function loadContextConfig(rootDir: string): Promise<LoadedContextConfig> {
  const configPath = await findConfigPath(rootDir)
  const require = createRequire(import.meta.url)
  const createJiti = require('jiti') as (
    filename: string,
    options?: { interopDefault?: boolean; cache?: boolean; alias?: Record<string, string> }
  ) => (path: string) => unknown
  const coreAlias = resolveLocalCoreAlias()
  const jiti = createJiti(resolve(rootDir, 'context.config.ts'), {
    interopDefault: true,
    cache: false,
    alias: {
      '@context-compiler/core': coreAlias
    }
  })
  const imported = jiti(configPath) as { default?: unknown } | unknown
  const configInput =
    imported && typeof imported === 'object' && 'default' in imported
      ? (imported as { default: unknown }).default
      : imported

  return {
    config: defineContextProject(configInput),
    path: configPath
  }
}

function resolveLocalCoreAlias(): string {
  const sourceEntry = fileURLToPath(new URL('./index.ts', import.meta.url))
  if (existsSync(sourceEntry)) {
    return sourceEntry
  }
  return fileURLToPath(new URL('./index.js', import.meta.url))
}

async function findConfigPath(rootDir: string): Promise<string> {
  const candidates = [
    'context.config.ts',
    'context.config.mts',
    'context.config.js',
    'context.config.mjs'
  ]

  for (const candidate of candidates) {
    const candidatePath = join(rootDir, candidate)
    try {
      await access(candidatePath)
      return candidatePath
    } catch {
      // Try the next known config filename.
    }
  }

  throw new Error(`No context.config.ts found in ${rootDir}`)
}
