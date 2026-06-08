import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeGraphFiles } from '@context-compiler/core/graph'
import { createContextNode, type ContextGraph } from '@context-compiler/core/sdk'
import { readContextViewerApi, resolveContextViewerStaticPath } from './viewer-server.js'

describe('context graph inspector server', () => {
  it('serves read-only graph viewer APIs and rejects path traversal', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-viewer-server-'))
    const outputDir = join(rootDir, '.context')
    const viewerDistDir = join(rootDir, 'viewer-dist')
    await mkdir(viewerDistDir, { recursive: true })
    await writeFile(join(viewerDistDir, 'index.html'), '<!doctype html><div id="root"></div>')
    await writeFile(join(rootDir, 'secret.txt'), 'do not serve me')
    await writeGraphFiles(graphFixture(), outputDir)
    await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify({ schemaVersion: 'context-runtime.v1', project: { name: 'viewer-test' } })}\n`)

    const manifest = await readApi('/api/manifest', outputDir)
    expect(manifest).toMatchObject({ project: { name: 'viewer-test' } })

    const overview = await readApi('/api/graph/overview', outputDir)
    expect(overview.elements.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'scope:project', type: 'ProjectGraph' })]))

    const search = await readApi('/api/search?q=uploadFileAPI', outputDir)
    expect(search.results).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'SYM-index-ts-uploadFileAPI' })]))

    expect(resolveContextViewerStaticPath(viewerDistDir, '/../secret.txt')).toBeUndefined()
    await expect(readFile(join(rootDir, 'secret.txt'), 'utf8')).resolves.toBe('do not serve me')
  })
})

function graphFixture(): ContextGraph {
  return {
    nodes: [
      createContextNode({ id: 'PROJECT-demo', type: 'Project', name: 'Demo Project' }),
      createContextNode({
        id: 'SYM-index-ts-uploadFileAPI',
        type: 'CodeSymbol',
        name: 'uploadFileAPI',
        sourceRefs: [{ sourceId: 'workspace', uri: 'file://src/index.ts', location: { path: 'src/index.ts' } }]
      })
    ],
    edges: [],
    diagnostics: []
  }
}

async function readApi(path: string, outputDir: string): Promise<any> {
  const result = await readContextViewerApi(new URL(path, 'http://context-viewer.local'), outputDir)
  expect(result.status).toBe(200)
  return result.body
}
