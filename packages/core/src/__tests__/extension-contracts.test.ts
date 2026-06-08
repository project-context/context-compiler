import { describe, expect, it } from 'vitest'
import { defineContextExtension, validateContextExtensionManifest, type ContextExtensionManifest, type DocumentExtractorAdapterManifest } from '@context-compiler/core/sdk'

describe('context extension contract', () => {
  it('defines and validates extension packages with parser and graph adapter manifests', () => {
    const extractor: DocumentExtractorAdapterManifest = {
      id: 'docling.document-extractor',
      title: 'Docling document extractor',
      version: '0.1.0',
      mediaTypes: ['application/pdf'],
      outputs: ['ParsedArtifact', 'GraphAdapterArtifact'],
      deterministic: true,
      requiresNetwork: false,
      stability: 'development',
      externalProjects: ['Docling']
    }
    const manifest = defineContextExtension({
      schemaVersion: 'context-extension.v1',
      id: 'extension.parser-docling',
      title: 'Docling parser extension',
      version: '0.1.0',
      category: 'document',
      stability: 'development',
      adapters: [{ kind: 'document-extractor', manifest: extractor }],
      externalProjects: ['Docling']
    })

    expect(validateContextExtensionManifest(manifest)).toEqual([])
    expect(manifest.adapters[0]).toMatchObject({
      kind: 'document-extractor',
      manifest: expect.objectContaining({ id: 'docling.document-extractor' })
    })
  })

  it('rejects extension manifests without stable ids or adapters', () => {
    const invalid: ContextExtensionManifest = {
      schemaVersion: 'context-extension.v1',
      id: '',
      title: 'Broken extension',
      version: '0.1.0',
      category: 'document',
      stability: 'development',
      adapters: []
    }

    expect(validateContextExtensionManifest(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'context-extension.invalid-manifest', properties: expect.objectContaining({ field: 'id' }) }),
        expect.objectContaining({ type: 'context-extension.invalid-manifest', properties: expect.objectContaining({ field: 'adapters' }) })
      ])
    )
  })
})
