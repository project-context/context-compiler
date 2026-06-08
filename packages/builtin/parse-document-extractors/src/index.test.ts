import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyPipelineState, type DocumentExtractionInput, type DocumentExtractorAdapter, type PipelineExecutionContext } from '@context-compiler/core/sdk'
import { createDocumentExtractorsParseComponent } from './index.js'

describe('document extractor parse component', () => {
  it('runs matching document extractors for complex inventory entries and merges parsed artifacts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-doc-extractors-'))
    const outputDir = join(rootDir, '.context')
    await mkdir(join(rootDir, 'sources'), { recursive: true })
    await writeFile(join(rootDir, 'sources', 'brief.pdf'), 'fake pdf bytes')
    const calls: DocumentExtractionInput[] = []
    const extractor: DocumentExtractorAdapter = {
      manifest: {
        id: 'docling.document-extractor',
        title: 'Docling',
        version: '0.1.0',
        mediaTypes: ['application/pdf'],
        outputs: ['ParsedArtifact', 'GraphAdapterArtifact'],
        deterministic: true,
        requiresNetwork: false,
        stability: 'development'
      },
      async extract(input) {
        calls.push(input)
        return {
          parsedArtifacts: [
            {
              id: 'parsed:docling:brief',
              kind: 'parsed',
              parser: 'markdown',
              source: input.entry.sourceRef,
              data: { meta: { id: 'DOC-BRIEF' }, title: 'Brief', sections: {}, body: '# Brief\n\n用户需要上传文件。' },
              metadata: { adapterId: 'docling.document-extractor' }
            }
          ],
          artifacts: [
            {
              id: 'docling-json',
              path: '.context/extensions/docling.document-extractor/artifacts/source-entry-brief/docling.json',
              mediaType: 'application/json'
            }
          ]
        }
      }
    }
    const component = createDocumentExtractorsParseComponent({ documentExtractors: [extractor] })
    const context: PipelineExecutionContext = {
      rootDir,
      outputDir,
      pipelineId: 'compile',
      stage: 'parse',
      config: { workspace: { rootDir, name: 'docs' }, sources: [] }
    }
    const sourceRef = {
      sourceId: 'workspace:sources-brief-pdf',
      uri: 'file://sources/brief.pdf',
      location: { path: 'sources/brief.pdf' }
    }

    const result = await component.process({
      ...emptyPipelineState(),
      artifacts: {
        sourceInventory: {
          schemaVersion: 'context-source-inventory.v1',
          entries: [
            {
              id: 'source-entry-brief',
              sourceName: 'workspace',
              root: './sources',
              path: 'sources/brief.pdf',
              uri: sourceRef.uri,
              mediaType: 'application/pdf',
              sizeBytes: 14,
              hash: 'hash',
              route: 'unsupported',
              status: 'unsupported',
              unsupportedReason: 'adapter-not-configured',
              sourceRef
            }
          ],
          summary: { roots: 1, files: 1, routed: 0, inventoryOnly: 0, unsupported: 1, skipped: 0 }
        }
      }
    }, context)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      entry: expect.objectContaining({ id: 'source-entry-brief' }),
      rootDir,
      outputDir
    })
    expect(result.parsedArtifacts).toEqual([
      expect.objectContaining({ id: 'parsed:docling:brief', parser: 'markdown' })
    ])
    expect(result.artifacts).toMatchObject({
      documentExtractorArtifacts: [expect.objectContaining({ id: 'docling-json' })],
      documentExtractorRuntimeStatuses: [expect.objectContaining({ adapterId: 'docling.document-extractor', state: 'not-required' })]
    })
  })

  it('does not run image extraction for ordinary app assets outside document-like groups', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-doc-extractors-image-'))
    const outputDir = join(rootDir, '.context')
    await mkdir(join(rootDir, 'sources', 'repo', 'public'), { recursive: true })
    await writeFile(join(rootDir, 'sources', 'repo', 'public', 'favicon.png'), 'fake image bytes')
    const calls: DocumentExtractionInput[] = []
    const extractor: DocumentExtractorAdapter = {
      manifest: {
        id: 'docling.document-extractor',
        title: 'Docling',
        version: '0.1.0',
        mediaTypes: ['image/png'],
        outputs: ['ParsedArtifact', 'GraphAdapterArtifact'],
        deterministic: true,
        requiresNetwork: false,
        stability: 'development'
      },
      async extract(input) {
        calls.push(input)
        return { parsedArtifacts: [] }
      }
    }
    const component = createDocumentExtractorsParseComponent({ documentExtractors: [extractor] })
    const context: PipelineExecutionContext = {
      rootDir,
      outputDir,
      pipelineId: 'compile',
      stage: 'parse',
      config: { workspace: { rootDir, name: 'docs' }, sources: [] }
    }
    const sourceRef = {
      sourceId: 'workspace:sources-repo-public-favicon-png',
      uri: 'file://sources/repo/public/favicon.png',
      location: { path: 'sources/repo/public/favicon.png' }
    }

    await component.process({
      ...emptyPipelineState(),
      artifacts: {
        sourceInventory: {
          schemaVersion: 'context-source-inventory.v1',
          groups: [
            {
              id: 'SOURCE-GROUP-repo',
              sourceName: 'workspace',
              path: 'sources/repo',
              title: 'repo',
              kind: 'repository',
              boundaryMode: 'repository',
              summary: 'Application source repository.',
              confidence: 0.9,
              decisionSource: 'inferred',
              sourceRef
            }
          ],
          entries: [
            {
              id: 'source-entry-favicon',
              sourceName: 'workspace',
              root: './sources',
              path: 'sources/repo/public/favicon.png',
              uri: sourceRef.uri,
              mediaType: 'image/png',
              sizeBytes: 16,
              hash: 'hash',
              route: 'unsupported',
              status: 'unsupported',
              unsupportedReason: 'adapter-not-configured',
              sourceRef
            }
          ],
          summary: { roots: 1, files: 1, groups: 1, routed: 0, inventoryOnly: 0, unsupported: 1, skipped: 0 }
        }
      }
    }, context)

    expect(calls).toHaveLength(0)
  })

  it('automatically installs a missing managed extractor runtime before executing the adapter', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-doc-extractors-runtime-'))
    const outputDir = join(rootDir, '.context')
    await mkdir(join(rootDir, 'sources'), { recursive: true })
    await writeFile(join(rootDir, 'sources', 'brief.pdf'), 'fake pdf bytes')
    const calls: DocumentExtractionInput[] = []
    const extractor: DocumentExtractorAdapter = {
      manifest: {
        id: 'docling.document-extractor',
        title: 'Docling',
        version: '0.1.0',
        mediaTypes: ['application/pdf'],
        outputs: ['ParsedArtifact', 'GraphAdapterArtifact'],
        deterministic: true,
        requiresNetwork: false,
        stability: 'development',
        runtime: {
          mode: 'managed-runtime',
          ecosystem: 'custom',
          packageName: 'fake-docling',
          executable: 'fake-docling',
          installCommands: [
            { command: process.execPath, args: ['-e', ''] }
          ]
        }
      },
      async extract(input) {
        calls.push(input)
        return { parsedArtifacts: [] }
      }
    }
    const component = createDocumentExtractorsParseComponent({ documentExtractors: [extractor] })
    const sourceRef = {
      sourceId: 'workspace:sources-brief-pdf',
      uri: 'file://sources/brief.pdf',
      location: { path: 'sources/brief.pdf' }
    }

    const result = await component.process({
      ...emptyPipelineState(),
      artifacts: {
        sourceInventory: {
          schemaVersion: 'context-source-inventory.v1',
          entries: [
            {
              id: 'source-entry-brief',
              sourceName: 'workspace',
              root: './sources',
              path: 'sources/brief.pdf',
              uri: sourceRef.uri,
              mediaType: 'application/pdf',
              sizeBytes: 14,
              hash: 'hash',
              route: 'unsupported',
              status: 'unsupported',
              unsupportedReason: 'adapter-not-configured',
              sourceRef
            }
          ],
          summary: { roots: 1, files: 1, routed: 0, inventoryOnly: 0, unsupported: 1, skipped: 0 }
        }
      }
    }, {
      rootDir,
      outputDir,
      pipelineId: 'compile',
      stage: 'parse',
      config: { workspace: { rootDir, name: 'docs' }, sources: [] }
    })

    expect(calls).toHaveLength(1)
    expect(result.diagnostics ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'adapter.runtime.missing' })
      ])
    )
    expect(result.artifacts).toMatchObject({
      documentExtractorRuntimeStatuses: [expect.objectContaining({ adapterId: 'docling.document-extractor', state: 'installed' })]
    })
    await expect(readFile(join(rootDir, '.context', 'extensions', 'docling.document-extractor', 'status.json'), 'utf8')).resolves.toContain(
      'docling.document-extractor'
    )
  })
})
