import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'

async function writeRuntimeProject(rootDir: string) {
  await mkdir(join(rootDir, 'docs', 'product'), { recursive: true })
  await mkdir(join(rootDir, 'docs', 'tests'), { recursive: true })
  await mkdir(join(rootDir, 'src'), { recursive: true })
  await writeFile(
    join(rootDir, 'context.config.json'),
    JSON.stringify(
      {
        sources: [
          { type: 'markdown', name: 'product-docs', path: './docs/product' },
          { type: 'markdown', name: 'test-cases', path: './docs/tests' },
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
paths:
  /api/orders/{id}/refund:
    post:
      operationId: refundOrder
      summary: Refund an order
`
  )
  await writeFile(join(rootDir, 'src', 'refund-service.ts'), 'export class RefundService {}\n')
}

async function expectFile(path: string): Promise<void> {
  await expect(access(path)).resolves.toBeUndefined()
}

describe('runtime workspace emission', () => {
  it('emits runtime directories, expanded manifest, and doctor output', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-runtime-workspace-'))
    await writeRuntimeProject(rootDir)

    const compile = await runCli(['compile'], { cwd: rootDir })
    expect(compile.exitCode).toBe(0)

    const contextDir = join(rootDir, '.context')
    await expectFile(join(contextDir, 'indexes', 'symbols.json'))
    await expectFile(join(contextDir, 'indexes', 'apis.json'))
    await expectFile(join(contextDir, 'indexes', 'search.json'))
    await expectFile(join(contextDir, 'runtime', 'runtime.config.json'))
    await expectFile(join(contextDir, 'runtime', 'runtime-plan.json'))
    await expectFile(join(contextDir, 'mcp', 'server.config.json'))
    await expectFile(join(contextDir, 'mcp', 'tools.json'))
    await expectFile(join(contextDir, 'tools', 'context-task-implementation.json'))
    await expectFile(join(contextDir, 'skills', 'implementation.md'))
    await expectFile(join(contextDir, 'skills', 'testing.md'))
    await expectFile(join(contextDir, 'agents', 'codex', 'AGENTS.generated.md'))
    await expectFile(join(contextDir, 'agents', 'claude', 'CLAUDE.generated.md'))
    await expectFile(join(contextDir, 'agents', 'cursor', 'rules', 'context.generated.md'))
    await expectFile(join(contextDir, 'plugins', 'context-compiler-local.json'))
    await expectFile(join(contextDir, 'diagnostics', 'context-health.json'))

    const manifest = JSON.parse(await readFile(join(contextDir, 'context-manifest.json'), 'utf8')) as {
      schemaVersion: string
      runtime: {
        plan: string
        trace: string
        runSummary: string
        agentInstallPlan: string
        freshness: { status: string }
        installStatus: Record<string, string>
        capabilitySurfaces: Record<string, string[]>
        providers: string[]
        tools: string[]
        skills: string[]
      }
      indexes: { symbols: string; apis: string; search: string }
    }
    expect(manifest.schemaVersion).toBe('context-runtime.v1')
    expect(manifest.indexes.search).toBe('.context/indexes/search.json')
    expect(manifest.runtime.plan).toBe('.context/runtime/runtime-plan.json')
    expect(manifest.runtime.trace).toBe('.context/runtime/trace.jsonl')
    expect(manifest.runtime.runSummary).toBe('.context/runtime/run-summary.json')
    expect(manifest.runtime.agentInstallPlan).toBe('.context/runtime/agent-install-plan.json')
    expect(manifest.runtime.freshness.status).toBe('fresh')
    expect(manifest.runtime.installStatus).toMatchObject({ codex: 'planned', claude: 'planned' })
    expect(manifest.runtime.capabilitySurfaces.codex).toEqual(
      expect.arrayContaining(['AGENTS.md', '.codex/config.toml', '.agents/skills'])
    )
    expect(manifest.runtime.capabilitySurfaces.claude).toEqual(
      expect.arrayContaining(['CLAUDE.md', '.mcp.json', '.claude/skills'])
    )
    expect(manifest.runtime.providers).toEqual([])
    expect(manifest.runtime.tools).toContain('context-task-implementation')
    expect(manifest.runtime.skills).toEqual(expect.arrayContaining(['implementation', 'testing', 'review']))
    await expectFile(join(contextDir, 'runtime', 'agent-install-plan.json'))

    const plan = JSON.parse(await readFile(join(contextDir, 'runtime', 'runtime-plan.json'), 'utf8')) as {
      schemaVersion: string
      capabilities: Array<{ id: string; kind: string; evidence: unknown[] }>
    }
    expect(plan.schemaVersion).toBe('context-runtime-plan.v1')
    expect(plan.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'context-task-implementation',
          kind: 'project-tool',
          evidence: expect.arrayContaining([expect.objectContaining({ nodeId: 'REQ-ORDER-REFUND-001' })])
        })
      ])
    )

    const doctor = await runCli(['doctor'], { cwd: rootDir })
    expect(doctor.exitCode).toBe(0)
    expect(doctor.stdout).toContain('Context runtime: healthy')
    expect(doctor.stdout).toContain('Nodes:')
    expect(doctor.stdout).toContain('Providers: 0')
    expect(doctor.stdout).toContain('Capability gaps:')
    expect(doctor.stdout).toContain('runtime.capability.not-generated')
  })
})
