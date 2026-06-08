import { describe, expect, it } from 'vitest'
import { validateContextExtensionManifest } from '@context-compiler/core'
import { doclingExtension } from '../../packages/extensions/document/parser-docling/src/index.js'
import { unstructuredExtension } from '../../packages/extensions/document/parser-unstructured/src/index.js'
import { microsoftGraphRagExtension } from '../../packages/extensions/knowledge/graph-microsoft-graphrag/src/index.js'
import { codeGraphExtension } from '../../packages/extensions/code/graph-codegraph/src/index.js'

describe('optional extension packages', () => {
  it('declares document, knowledge, and code adapters without adding heavy dependencies to the core compiler', () => {
    const extensions = [doclingExtension, unstructuredExtension, microsoftGraphRagExtension, codeGraphExtension]

    expect(extensions.flatMap((extension) => extension.adapters.map((adapter) => adapter.kind))).toEqual([
      'document-extractor',
      'document-extractor',
      'graph-adapter',
      'graph-adapter'
    ])
    expect(extensions.flatMap((extension) => validateContextExtensionManifest(extension))).toEqual([])
    expect(microsoftGraphRagExtension.adapters[0]?.manifest).toMatchObject({
      id: 'microsoft-graphrag.graph-adapter',
      sourceGroupKinds: ['doc_bundle', 'analysis_bundle', 'domain_area']
    })
    expect(codeGraphExtension.adapters[0]?.manifest).toMatchObject({
      id: 'codegraph.graph-adapter',
      sourceGroupKinds: ['repository']
    })
  })
})
