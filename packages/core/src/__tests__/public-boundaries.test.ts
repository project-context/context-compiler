import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('core public boundary imports', () => {
  it('uses explicit core subpath imports inside package source files', async () => {
    const rootDir = process.cwd()
    const files = await listSourceFiles(join(rootDir, 'packages'))
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
