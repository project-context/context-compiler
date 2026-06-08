import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDoclingDocumentExtractorAdapter, doclingRuntimePaths, type DoclingRuntime } from './index.js'
import type { DocumentExtractionInput } from '@context-compiler/core'

const sourceRef = {
  sourceId: 'workspace:sources-brief-pdf',
  uri: 'file://sources/brief.pdf',
  location: { path: 'sources/brief.pdf' }
}

function input(rootDir: string): DocumentExtractionInput {
  return {
    rootDir,
    outputDir: join(rootDir, '.context'),
    entry: {
      id: 'source-entry-brief',
      sourceName: 'workspace',
      root: './sources',
      path: 'sources/brief.pdf',
      uri: sourceRef.uri,
      mediaType: 'application/pdf',
      sizeBytes: 12,
      hash: 'hash',
      route: 'unsupported',
      status: 'unsupported',
      unsupportedReason: 'adapter-not-configured',
      sourceRef
    }
  }
}

describe('Docling document extractor', () => {
  it('uses a managed venv location under .context runtime', () => {
    const paths = doclingRuntimePaths('/repo/.context')
    expect(paths.runtimeDir).toBe('/repo/.context/extensions/docling.document-extractor/runtime')
    expect(paths.venvDir).toBe('/repo/.context/extensions/docling.document-extractor/runtime/.venv')
    expect(paths.executablePath).toContain('/repo/.context/extensions/docling.document-extractor/runtime/.venv/')
    expect(paths.markerPath).toBe('/repo/.context/extensions/docling.document-extractor/status.json')
  })

  it('declares Docling as a managed Python runtime', () => {
    const adapter = createDoclingDocumentExtractorAdapter()

    expect(adapter.manifest.runtime).toMatchObject({
      mode: 'managed-runtime',
      ecosystem: 'python',
      packageName: 'docling',
      executable: 'docling'
    })
  })

  it('converts complex documents into Docling JSON artifact and markdown parsed artifact', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-docling-'))
    const runtimeCalls: DocumentExtractionInput[] = []
    const runtime: DoclingRuntime = {
      async convertDocument(callInput) {
        runtimeCalls.push(callInput)
        return {
          json: { schema_name: 'DoclingDocument', name: 'Brief' },
          markdown: '# Brief\n\n用户需要上传文件。',
          metadata: { pages: 1, backend: 'fixture' }
        }
      }
    }
    const adapter = createDoclingDocumentExtractorAdapter({ runtime })

    const result = await adapter.extract(input(rootDir))

    expect(runtimeCalls).toHaveLength(1)
    expect(result.parsedArtifacts).toEqual([
      expect.objectContaining({
        id: 'parsed:docling:source-entry-brief',
        parser: 'markdown',
        source: sourceRef,
        data: expect.objectContaining({
          title: 'Brief',
          body: '# Brief\n\n用户需要上传文件。'
        })
      })
    ])
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '.context/extensions/docling.document-extractor/artifacts/source-entry-brief/docling.json' }),
        expect.objectContaining({ path: '.context/extensions/docling.document-extractor/artifacts/source-entry-brief/docling.md' })
      ])
    )
    await expect(readFile(join(rootDir, '.context', 'extensions', 'docling.document-extractor', 'artifacts', 'source-entry-brief', 'docling.md'), 'utf8')).resolves.toContain('用户需要上传文件')
  })
})
