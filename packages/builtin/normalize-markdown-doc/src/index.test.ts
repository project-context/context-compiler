import { describe, expect, it } from 'vitest'
import { emptyPipelineState } from '@context-compiler/core/kernel'
import { createMarkdownDocNormalizeComponent } from './index.js'

describe('markdown document normalization', () => {
  it('treats untyped README files as documents while preserving product docs as requirements', async () => {
    const component = createMarkdownDocNormalizeComponent()
    const result = await component.process?.(
      {
        ...emptyPipelineState(),
        parsedArtifacts: [
          {
            id: 'parsed:readme',
            kind: 'parsed',
            parser: 'markdown',
            source: {
              sourceId: 'workspace:sources-app-README.md',
              uri: 'file://sources/app/README.md',
              title: 'workspace',
              location: { path: 'sources/app/README.md' }
            },
            data: { meta: {}, title: 'README', sections: {}, body: '# README\n' }
          },
          {
            id: 'parsed:product',
            kind: 'parsed',
            parser: 'markdown',
            source: {
              sourceId: 'workspace:sources-product-docs-intro.md',
              uri: 'file://sources/product-docs/intro.md',
              title: 'workspace',
              location: { path: 'sources/product-docs/intro.md' }
            },
            data: { meta: {}, title: 'Product Intro', sections: {}, body: '# Product Intro\n' }
          }
        ]
      },
      {
        rootDir: '/workspace',
        outputDir: '/workspace/.context',
        config: { workspace: { rootDir: '/workspace', name: 'workspace' }, sources: [] },
        pipelineId: 'compile',
        stage: 'normalize'
      }
    )

    expect(result?.normalizedRecords?.map((record) => [record.id, record.semanticType])).toEqual([
      ['README', 'document'],
      ['PRODUCT-INTRO', 'requirement']
    ])
  })
})
