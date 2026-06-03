import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'
import { callContextMcpTool, startContextMcpStdioServer } from '@context-compiler/mcp-server'

async function writeRuntimeToolsProject(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'src'), { recursive: true })
  await writeFile(
    join(rootDir, 'context.config.json'),
    JSON.stringify(
      {
        sources: [
          { type: 'markdown', name: 'product-docs', path: './docs/product' },
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
`
  )
  await writeFile(join(rootDir, 'src', 'refund-service.ts'), 'export class RefundService {}\n')
}

async function callMcpServer(rootDir: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks: Buffer[] = []
  output.on('data', (chunk) => chunks.push(Buffer.from(chunk as Buffer)))
  const server = startContextMcpStdioServer({ rootDir, input, output })
  input.write(`${JSON.stringify(request)}\n`)
  input.end()
  await server
  return JSON.parse(Buffer.concat(chunks).toString('utf8').trim()) as Record<string, unknown>
}

async function listMcpTools(rootDir: string): Promise<Array<{ name: string; inputSchema: Record<string, unknown> }>> {
  const response = await callMcpServer(rootDir, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) as {
    result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> }
  }
  return response.result.tools
}

describe('runtime MCP tools', () => {
  it('exposes manifest, health, trace, runtime plan, refresh, and capability explanation tools', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-runtime-tools-'))
    await writeRuntimeToolsProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    await expect(callContextMcpTool(rootDir, 'get_context_manifest', {})).resolves.toMatchObject({
      data: { schemaVersion: 'context-runtime.v1' },
      evidence: expect.any(Array),
      freshness: expect.objectContaining({ status: 'fresh' }),
      diagnostics: expect.any(Array)
    })
    await expect(callContextMcpTool(rootDir, 'get_context_health', {})).resolves.toMatchObject({
      data: { schemaVersion: 'context-runtime.v1' }
    })
    await expect(callContextMcpTool(rootDir, 'get_agent_runtime_plan', {})).resolves.toMatchObject({
      data: { schemaVersion: 'context-runtime-plan.v1' }
    })
    await expect(callContextMcpTool(rootDir, 'explain_capability', { capabilityId: 'context-compile' })).resolves.toMatchObject({
      data: { capability: expect.objectContaining({ id: 'context-compile', kind: 'project-tool' }) }
    })
    await expect(callContextMcpTool(rootDir, 'get_source_trace', { nodeId: 'REQ-ORDER-REFUND-001' })).resolves.toMatchObject({
      data: {
        node: expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' }),
        source: expect.objectContaining({ uri: expect.stringContaining('docs/product/refund.md') })
      }
    })
    await expect(callContextMcpTool(rootDir, 'refresh_context', {})).resolves.toMatchObject({
      data: {
        refreshed: true,
        graph: expect.objectContaining({ nodes: expect.any(Number), edges: expect.any(Number) })
      }
    })
  })

  it('publishes concrete JSON input schemas through tools/list', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-tool-schema-'))
    await writeRuntimeToolsProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    const tools = await listMcpTools(rootDir)
    expect(tools.find((tool) => tool.name === 'search_context')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query']
    })
    expect(tools.find((tool) => tool.name === 'explain_capability')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        capabilityId: { type: 'string' }
      },
      required: ['capabilityId']
    })
  })

  it('publishes MCP server instructions and runtime resources for agent-native discovery', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-resources-'))
    await writeRuntimeToolsProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    const initialized = await callMcpServer(rootDir, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as {
      result: { instructions: string; capabilities: { resources: unknown } }
    }
    expect(initialized.result.instructions).toContain('Context Compiler')
    expect(initialized.result.instructions).toContain('get_context_health')
    expect(initialized.result.capabilities.resources).toEqual({})

    const listed = await callMcpServer(rootDir, { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} }) as {
      result: { resources: Array<{ uri: string; name: string }> }
    }
    expect(listed.result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uri: 'context://manifest' }),
        expect.objectContaining({ uri: 'context://health' }),
        expect.objectContaining({ uri: 'context://views/project' })
      ])
    )

    const read = await callMcpServer(rootDir, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'context://manifest' }
    }) as { result: { contents: Array<{ text: string }> } }
    expect(read.result.contents[0].text).toContain('"schemaVersion": "context-runtime.v1"')
  })
})
