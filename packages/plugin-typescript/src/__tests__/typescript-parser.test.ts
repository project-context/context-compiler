import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTypeScriptParserPlugin } from '../index.js'

let workspace: string | undefined

afterEach(async () => {
  if (workspace) {
    await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  }
})

describe('typescript parser plugin', () => {
  it('extracts exported classes and functions as code_symbol nodes', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'context-typescript-'))
    const srcDir = join(workspace, 'src')
    await mkdir(srcDir, { recursive: true })
    await writeFile(
      join(srcDir, 'refund-service.ts'),
      `export class RefundService {
  refundOrder(orderId: string) {
    return orderId
  }
}

export function calculateRefund(amount: number) {
  return amount
}
`
    )

    const result = await createTypeScriptParserPlugin().parse(
      { type: 'git', name: 'source', path: './src' },
      { rootDir: workspace, outputDir: '.context' }
    )

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'code_symbol',
          title: 'RefundService',
          metadata: expect.objectContaining({
            kind: 'class',
            name: 'RefundService'
          })
        }),
        expect.objectContaining({
          type: 'code_symbol',
          title: 'calculateRefund',
          metadata: expect.objectContaining({
            kind: 'function',
            name: 'calculateRefund'
          })
        })
      ])
    )
  })
})
