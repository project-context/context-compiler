import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarkdownParserPlugin } from '../index.js'

let workspace: string | undefined

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  }
})

describe('markdown parser plugin', () => {
  it('extracts requirement, rules, acceptance criteria, related APIs, and test cases', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-markdown-'))
    const docsDir = join(workspace, 'docs', 'product')
    await mkdir(docsDir, { recursive: true })
    await writeFile(
      join(docsDir, 'refund.md'),
      `---
id: REQ-ORDER-REFUND-001
type: requirement
domain: order
status: active
owner: product
updatedAt: 2026-06-02T00:00:00.000Z
sourceUri: feishu://doc/refund
---

# 支持订单部分退款

## Business Rules

- Refund amount must not exceed refundable amount.

## Acceptance Criteria

- Given a paid order, when a partial refund is requested, then the refunded amount is recorded.

## Related APIs

- POST /api/orders/{id}/refund

## Test Cases

- TC-REFUND-001: supports partial refund
`
    )

    const result = await createMarkdownParserPlugin().parse(
      { type: 'markdown', name: 'product-docs', path: './docs/product' },
      { rootDir: workspace, outputDir: '.context' }
    )

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'REQ-ORDER-REFUND-001',
          type: 'requirement',
          title: '支持订单部分退款',
          domain: 'order',
          metadata: expect.objectContaining({
            relatedApis: ['POST /api/orders/{id}/refund']
          })
        }),
        expect.objectContaining({
          id: 'REQ-ORDER-REFUND-001-BR-1',
          type: 'business_rule'
        }),
        expect.objectContaining({
          id: 'REQ-ORDER-REFUND-001-AC-1',
          type: 'acceptance_criteria',
          metadata: expect.objectContaining({
            requirementId: 'REQ-ORDER-REFUND-001'
          })
        }),
        expect.objectContaining({
          id: 'TC-REFUND-001',
          type: 'test_case',
          metadata: expect.objectContaining({
            requirementIds: ['REQ-ORDER-REFUND-001']
          })
        })
      ])
    )
  })
})
