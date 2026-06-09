import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('core public boundary imports', () => {
  it('uses explicit core subpath imports inside package and test source files', async () => {
    const rootDir = process.cwd()
    const files = [
      ...await listSourceFiles(join(rootDir, 'packages')),
      ...await listSourceFiles(join(rootDir, 'tests'))
    ]
    const offenders: string[] = []

    for (const file of files) {
      const rel = relative(rootDir, file)
      if (rel === 'packages/core/src/index.ts') {
        continue
      }
      const content = await readFile(file, 'utf8')
      if (/@context-compiler\/core['"]/.test(content)) {
        offenders.push(rel)
      }
    }

    expect(offenders).toEqual([])
  })

  it('does not expose the removed core root entrypoint through exports or local aliases', async () => {
    const rootDir = process.cwd()
    const corePackage = JSON.parse(await readFile(join(rootDir, 'packages', 'core', 'package.json'), 'utf8')) as {
      exports?: Record<string, string>
    }
    expect(corePackage.exports?.['.']).toBeUndefined()

    const files = ['tsconfig.json', 'vitest.config.ts', join('scripts', 'ts-loader.mjs')]
    const offenders: string[] = []
    for (const file of files) {
      const content = await readFile(join(rootDir, file), 'utf8')
      if (/['"]@context-compiler\/core['"]/.test(content)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the sdk subpath focused on component and adapter development APIs', async () => {
    const sdk = await readFile(join(process.cwd(), 'packages', 'core', 'src', 'sdk', 'index.ts'), 'utf8')
    const forbidden = [
      '../contracts/index',
      '../config/',
      '../extensions/',
      '../graph/scopes',
      '../pipeline/state',
      '../kernel/',
      '../runtime/'
    ]
    expect(forbidden.filter((pattern) => sdk.includes(pattern))).toEqual([])
  })

  it('keeps subpath APIs from re-exporting the contracts aggregate', async () => {
    const rootDir = process.cwd()
    const files = [
      'packages/core/src/sdk/index.ts',
      'packages/core/src/graph/index.ts',
      'packages/core/src/runtime/index.ts',
      'packages/core/src/kernel/index.ts',
      'packages/core/src/compiler/index.ts'
    ]
    const offenders: string[] = []
    for (const file of files) {
      const content = await readFile(join(rootDir, file), 'utf8')
      if (/export\s+(?:type\s+)?\*\s+from\s+['"]\.\.\/contracts\/index\.js['"]/.test(content)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('uses domain contract files instead of the contracts aggregate inside core implementation source', async () => {
    const rootDir = process.cwd()
    const files = await listSourceFiles(join(rootDir, 'packages', 'core', 'src'))
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(rootDir, file)
      if (rel.includes('/__tests__/') || rel === 'packages/core/src/contracts/index.ts') {
        continue
      }
      const content = await readFile(file, 'utf8')
      if (/from\s+['"][^'"]*contracts\/index\.js['"]/.test(content) || /import\(['"][^'"]*contracts\/index\.js['"]\)/.test(content)) {
        offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps package import relationships inside the intended subpath matrix', async () => {
    const rootDir = process.cwd()
    const files = await listSourceFiles(join(rootDir, 'packages'))
    const offenders: string[] = []
    const importPattern = /@context-compiler\/core\/([a-z-]+)/g
    const allowedExtensionSubpaths = new Set(['sdk', 'extensions', 'graph'])
    const runtimeBuiltinAllowlist = new Set([
      'packages/builtin/compress-context-view',
      'packages/builtin/compress-runtime-plan',
      'packages/builtin/emit-files'
    ])

    for (const file of files) {
      const rel = relative(rootDir, file)
      const content = await readFile(file, 'utf8')
      const subpaths = [...content.matchAll(importPattern)].map((match) => match[1])
      if (/\.(test|spec)\.tsx?$/.test(rel)) {
        continue
      }

      if (rel.startsWith('packages/extensions/')) {
        for (const subpath of subpaths) {
          if (!allowedExtensionSubpaths.has(subpath)) {
            offenders.push(`${rel}: extensions must not import core/${subpath}`)
          }
        }
      }

      if (rel.startsWith('packages/builtin/')) {
        if (subpaths.includes('compiler') || subpaths.includes('kernel')) {
          offenders.push(`${rel}: builtin packages must not import core/compiler or core/kernel`)
        }
        if (subpaths.includes('runtime') && ![...runtimeBuiltinAllowlist].some((prefix) => rel.startsWith(prefix))) {
          offenders.push(`${rel}: builtin package is not allowed to import core/runtime`)
        }
      }

      if (rel.startsWith('packages/core/src/runtime/') && /@context-compiler\/(?:builtin|extension)-/.test(content)) {
        offenders.push(`${rel}: runtime must not import builtin or extension packages`)
      }

      if (rel.startsWith('packages/core/src/source-model/') && /@context-compiler\/core\/(?:runtime|compiler|kernel)/.test(content)) {
        offenders.push(`${rel}: source-model must not import runtime, compiler, or kernel`)
      }
    }

    expect(offenders).toEqual([])
  })
})

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          return []
        }
        return listSourceFiles(path)
      }
      return /\.(tsx?|mts|cts)$/.test(entry.name) ? [path] : []
    })
  )
  return nested.flat()
}
