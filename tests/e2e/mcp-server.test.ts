import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'
import { callContextMcpTool } from '@context-compiler/mcp-server'
import { installMockGraphRagRuntimeHooks } from './mock-graphrag.js'

installMockGraphRagRuntimeHooks()

async function writeMcpProject(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'docs', 'runtime'), { recursive: true })
  await mkdir(join(rootDir, 'src'), { recursive: true })
  await writeFile(
    join(rootDir, 'context.config.json'),
    JSON.stringify(
      {
        sources: [
          { type: 'markdown', name: 'product-docs', path: './docs/product' },
          { type: 'markdown', name: 'runtime-signals', path: './docs/runtime' },
          { type: 'openapi', name: 'api-spec', path: './openapi.yaml' },
          { type: 'code', name: 'source', path: './src' }
        ]
      },
      null,
      2
    )
  )
  await writeFile(
    join(rootDir, 'docs', 'product', 'refund.md'),
    `---
id: REQ-ORDER-REFUND-001
type: requirement
domain: order
---

# Support partial refund

## Acceptance Criteria

- Refund amount is recorded.

## Related APIs

- POST /api/orders/{id}/refund
`
  )
  await writeFile(
    join(rootDir, 'docs', 'runtime', 'refund-metrics.md'),
    `---
id: RUNTIME-refund-error-rate
type: runtime_signal
providerId: refund-metrics
---

# Refund API error rate

24h error rate for refund API.
`
  )
  await writeFile(
    join(rootDir, 'openapi.yaml'),
    `openapi: 3.0.3
paths:
  /api/orders/{id}/refund:
    post:
      operationId: refundOrder
      summary: Refund an order
`
  )
  await writeFile(join(rootDir, 'src', 'refund-service.ts'), 'export class RefundService {}\n')
}

describe('context MCP server tools', () => {
  it('queries compiled context and inferred runtime providers', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-server-'))
    await writeMcpProject(rootDir)
    const compile = await runCli(['compile'], { cwd: rootDir })
    expect(compile.exitCode).toBe(0)

    const search = await callContextMcpTool(rootDir, 'search_context', { query: 'refund' })
    expect(search).toMatchObject({
      data: {
        results: expect.arrayContaining([expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' })])
      }
    })

    const task = await callContextMcpTool(rootDir, 'get_task_context', {
      task: 'Support partial refund',
      focus: 'implementation'
    })
    expect(task).toMatchObject({
      data: {
        task: 'Support partial refund',
        focus: 'implementation'
      }
    })

    const runtimeConfig = await callContextMcpTool(rootDir, 'get_runtime_config', {})
    expect(runtimeConfig).toMatchObject({
      data: {
        providers: expect.arrayContaining([expect.objectContaining({ name: 'refund-metrics', transport: 'static' })])
      }
    })

    const staticProvider = await callContextMcpTool(rootDir, 'query_runtime_provider', { providerId: 'refund-metrics' })
    expect(staticProvider).toMatchObject({
      data: {
        nodeId: 'RUNTIME-refund-error-rate',
        source: expect.stringContaining('docs/runtime/refund-metrics.md')
      }
    })

    await expect(callContextMcpTool(rootDir, 'get_test_coverage', {})).rejects.toThrow(/not generated/)
  })

  it('denies command and http providers unless explicit runtime policy allows them', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-provider-policy-'))
    await writeMcpProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    const runtimeConfigPath = join(rootDir, '.context', 'runtime', 'runtime.config.json')
    const runtimeConfig = JSON.parse(await readFile(runtimeConfigPath, 'utf8')) as {
      providers: Array<Record<string, unknown>>
    }
    runtimeConfig.providers = [
      {
        name: 'unsafe-command',
        kind: 'static',
        transport: 'command',
        command: 'node',
        args: ['-e', 'console.log("unsafe")']
      }
    ]
    await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`)

    await expect(callContextMcpTool(rootDir, 'query_runtime_provider', { providerId: 'unsafe-command' })).rejects.toThrow(
      /requires explicit policy/
    )
  })
})
