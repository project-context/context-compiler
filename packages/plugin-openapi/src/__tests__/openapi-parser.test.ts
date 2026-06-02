import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpenApiParserPlugin } from '../index.js'

let workspace: string | undefined

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  }
})

describe('openapi parser plugin', () => {
  it('extracts OpenAPI operations as api_contract nodes', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-openapi-'))
    await writeFile(
      join(workspace, 'openapi.yaml'),
      `openapi: 3.0.3
info:
  title: Example Shop
  version: 1.0.0
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

    const result = await createOpenApiParserPlugin().parse(
      { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
      { rootDir: workspace, outputDir: '.context' }
    )

    expect(result.nodes).toEqual([
      expect.objectContaining({
        id: 'API-POST-api-orders-id-refund',
        type: 'api_contract',
        title: 'POST /api/orders/{id}/refund',
        metadata: expect.objectContaining({
          method: 'POST',
          path: '/api/orders/{id}/refund',
          operationId: 'refundOrder'
        })
      })
    ])
  })
})
