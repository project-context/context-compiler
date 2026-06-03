import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalDistribution } from '@context-compiler/distribution-local'
import { compileContextProject, defineContextProject, generateTaskContext, loadGraphFiles, renderTaskContextMarkdown } from '@context-compiler/core'

async function writeExampleProject(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'docs', 'tests'), { recursive: true })
  await mkdir(join(rootDir, 'src'), { recursive: true })

  await writeFile(
    join(rootDir, 'docs', 'product', 'refund.md'),
    `---
id: REQ-ORDER-REFUND-001
type: requirement
domain: order
status: active
sourceUri: feishu://doc/refund
---

# 支持订单部分退款

## Acceptance Criteria

- Given a paid order, when a partial refund is requested, then the refunded amount is recorded.

## Related APIs

- POST /api/orders/{id}/refund
`
  )

  await writeFile(
    join(rootDir, 'docs', 'tests', 'refund-tests.md'),
    `---
id: TEST-ORDER-REFUND
type: test_case
domain: order
requirementIds:
  - REQ-ORDER-REFUND-001
---

# 退款测试

## Test Cases

- TC-REFUND-001: supports partial refund
`
  )

  await writeFile(
    join(rootDir, 'openapi.yaml'),
    `openapi: 3.0.3
info:
  title: Example Shop
paths:
  /api/orders/{id}/refund:
    post:
      operationId: refundOrder
      summary: Refund an order
      responses:
        '200':
          description: ok
`
  )

  await writeFile(
    join(rootDir, 'src', 'refund-service.ts'),
    `export class RefundService {
  refundOrder(orderId: string) {
    return orderId
  }
}
`
  )
}

describe('local distribution', () => {
  it('plans the default compile pipeline from source types', () => {
    const distribution = createLocalDistribution()
    const markdownOnly = distribution.planPipeline?.(defineContextProject({
      sources: [{ type: 'markdown', name: 'product-docs', path: './docs/product' }]
    }, { rootDir: '/workspace' }), 'compile')

    expect(markdownOnly?.stages.parse).toEqual(['parse.markdown'])
    expect(markdownOnly?.stages.normalize).toEqual(['normalize.markdown-doc'])
    expect(markdownOnly?.stages.enrich).toEqual(['enrich.inventory'])
    expect(markdownOnly?.stages.enrich).not.toContain('enrich.symbol-index')
    expect(markdownOnly?.stages.compress).toContain('compress.runtime-plan')

    const full = distribution.planPipeline?.(defineContextProject({
      sources: [
        { type: 'markdown', name: 'product-docs', path: './docs/product' },
        { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
        { type: 'code', name: 'source', path: './src' }
      ]
    }, { rootDir: '/workspace' }), 'compile')

    expect(full?.stages.parse).toEqual(['parse.markdown', 'parse.openapi'])
    expect(full?.stages.normalize).toEqual(['normalize.markdown-doc', 'normalize.openapi-contract'])
    expect(full?.stages.enrich).toEqual(['enrich.inventory', 'enrich.symbol-index'])
  })

  it('compiles project sources through configured pipeline components', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-compiler-local-'))
    await writeExampleProject(rootDir)
    await mkdir(join(rootDir, '.context', 'views'), { recursive: true })
    await writeFile(join(rootDir, '.context', 'views', 'backend.md'), '# stale backend view\n')

    const distribution = createLocalDistribution()
    const result = await compileContextProject({
      rootDir,
      distribution,
      config: {
        sources: [
          { type: 'markdown', name: 'product-docs', path: './docs/product' },
          { type: 'markdown', name: 'test-cases', path: './docs/tests' },
          { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
          { type: 'code', name: 'source', path: './src' }
        ]
      }
    })

    expect(result.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'REQ-ORDER-REFUND-001',
        'AC-REQ-ORDER-REFUND-001-1',
        'API-POST-api-orders-id-refund',
        'TEST-ORDER-REFUND',
        'SYM-refund-service-ts-RefundService'
      ])
    )
    expect(result.graph.edges.map((edge) => edge.type)).toEqual(
      expect.arrayContaining(['has_acceptance_criteria', 'relates_to', 'verified_by'])
    )

    const graph = await loadGraphFiles(join(rootDir, '.context'))
    const task = generateTaskContext(graph, result.config, {
      task: '支持订单部分退款',
      focus: 'implementation',
      module: 'refund'
    })

    expect(renderTaskContextMarkdown(task)).toContain('REQ-ORDER-REFUND-001')
    await expect(readFile(join(rootDir, '.context', 'views', 'implementation.md'), 'utf8')).resolves.toContain(
      'Implementation Context'
    )
    await expect(readFile(join(rootDir, '.context', 'views', 'design.md'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(rootDir, '.context', 'views', 'backend.md'), 'utf8')).rejects.toThrow()
  })
})
