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
    await mkdir(join(rootDir, '.context', 'graph', 'subgraphs'), { recursive: true })
    await writeFile(join(rootDir, '.context', 'graph', 'subgraphs', 'source.nodes.jsonl'), '{"id":"stale"}\n')

    const compile = await runCli(['compile'], { cwd: rootDir })
    expect(compile.exitCode).toBe(0)

	    const contextDir = join(rootDir, '.context')
	    await expectFile(join(contextDir, 'manifest.json'))
	    await expect(access(join(contextDir, 'context-manifest.json'))).rejects.toThrow()
    await expectFile(join(contextDir, 'sources', 'inventory.jsonl'))
    await expectFile(join(contextDir, 'sources', 'routes.jsonl'))
    await expectFile(join(contextDir, 'sources', 'unsupported.jsonl'))
    await expectFile(join(contextDir, 'sources', 'groups.jsonl'))
    await expectFile(join(contextDir, 'sources', 'summary.json'))
    await expectFile(join(contextDir, 'graph', 'global', 'nodes.jsonl'))
    await expectFile(join(contextDir, 'graph', 'global', 'edges.jsonl'))
    await expectFile(join(contextDir, 'graph', 'revisions', 'revisions.jsonl'))
    await expectFile(join(contextDir, 'graph', 'patches', 'patches.jsonl'))
    await expectFile(join(contextDir, 'graph', 'evidence-reports.jsonl'))
    await expectFile(join(contextDir, 'graph', 'subgraphs', 'code.nodes.jsonl'))
    await expectFile(join(contextDir, 'graph', 'subgraphs', 'api.nodes.jsonl'))
    await expect(access(join(contextDir, 'graph', 'subgraphs', 'source.nodes.jsonl'))).rejects.toThrow()
    await expectFile(join(contextDir, 'graph', 'partitions', 'domain', 'order.nodes.jsonl'))
    await expectFile(join(contextDir, 'indexes', 'global', 'symbols.sqlite'))
    await expectFile(join(contextDir, 'indexes', 'global', 'api.sqlite'))
    await expectFile(join(contextDir, 'indexes', 'global', 'fts.sqlite'))
    await expectFile(join(contextDir, 'plans', 'source-triage.json'))
    await expectFile(join(contextDir, 'plans', 'planning-pack.json'))
    await expectFile(join(contextDir, 'plans', 'planning-cycles.jsonl'))
    await expectFile(join(contextDir, 'plans', 'workspace-graph-plan.json'))
    await expectFile(join(contextDir, 'plans', 'scope-build-plan.json'))
    await expectFile(join(contextDir, 'proposals', 'rehome-proposals.jsonl'))
    await expectFile(join(contextDir, 'runtime', 'runtime.config.json'))
    await expectFile(join(contextDir, 'runtime', 'runtime-plan.json'))
    await expectFile(join(contextDir, 'mcp', 'server.config.json'))
    await expectFile(join(contextDir, 'mcp', 'tools.json'))
    await expectFile(join(contextDir, 'tools', 'context_task_implementation.json'))
    await expectFile(join(contextDir, 'skills', 'implementation.md'))
    await expectFile(join(contextDir, 'skills', 'testing.md'))
    await expectFile(join(contextDir, 'agents', 'codex', 'AGENTS.generated.md'))
    await expectFile(join(contextDir, 'agents', 'claude', 'CLAUDE.generated.md'))
    await expectFile(join(contextDir, 'agents', 'cursor', 'rules', 'context.generated.md'))
    await expectFile(join(contextDir, 'plugins', 'context-compiler-local.json'))
    await expectFile(join(contextDir, 'diagnostics', 'context-health.json'))
    await expectFile(join(contextDir, 'diagnostics', 'latest.jsonl'))
    await expectFile(join(contextDir, 'artifacts', 'project', 'brief.md'))
    await expectFile(join(contextDir, 'artifacts', 'domains', 'order.md'))
    await expectFile(join(contextDir, 'artifacts', 'reports', 'diagnostics.md'))

    const manifest = JSON.parse(await readFile(join(contextDir, 'manifest.json'), 'utf8')) as {
      schemaVersion: string
      runtime: {
        providers: string
        tools: string
        plan: string
        trace: string
        runSummary: string
        agentInstallPlan: string
        freshness: { status: string }
        installStatus: Record<string, string>
        capabilitySurfaces: Record<string, string[]>
        skills: string[]
      }
      sources: {
        inventory: string
        routes: string
        unsupported: string
        summary: string
        groups: string
        packages: string
        buildUnits: string
        groupingRequest: string
        groupingDecisions: string
        correctionDecisions: string
      }
      graph: { nodes: string; edges: string; subgraphs: string; partitions: string; revisions: string; patches: string; evidenceReports: string }
      indexes: { symbols: string; apis: string; fts: string }
      plans: { workspaceGraph: string; planningPack: string; planningCycles: string }
      proposals: { rehome: string; corrections: string }
    }
    expect(manifest.schemaVersion).toBe('context-runtime.v1')
    expect(manifest.sources).toMatchObject({
      inventory: '.context/sources/inventory.jsonl',
      routes: '.context/sources/routes.jsonl',
      unsupported: '.context/sources/unsupported.jsonl',
      summary: '.context/sources/summary.json',
      groups: '.context/sources/groups.jsonl',
      packages: '.context/sources/packages.jsonl',
      buildUnits: '.context/sources/build-units.jsonl',
      groupingRequest: '.context/sources/grouping-request.json',
      groupingDecisions: '.context/sources/grouping-decisions.json',
      correctionDecisions: '.context/sources/correction-decisions.jsonl'
    })
    expect(manifest.graph.nodes).toBe('.context/graph/global/nodes.jsonl')
    expect(manifest.graph.edges).toBe('.context/graph/global/edges.jsonl')
    expect(manifest.graph.subgraphs).toBe('.context/graph/subgraphs')
    expect(manifest.graph.partitions).toBe('.context/graph/partitions')
    expect(manifest.graph.revisions).toBe('.context/graph/revisions/revisions.jsonl')
    expect(manifest.graph.patches).toBe('.context/graph/patches/patches.jsonl')
    expect(manifest.graph.evidenceReports).toBe('.context/graph/evidence-reports.jsonl')
    expect(manifest.indexes.fts).toBe('.context/indexes/global/fts.sqlite')
    expect(manifest.plans.workspaceGraph).toBe('.context/plans/workspace-graph-plan.json')
    expect(manifest.plans.planningPack).toBe('.context/plans/planning-pack.json')
    expect(manifest.plans.planningCycles).toBe('.context/plans/planning-cycles.jsonl')
    expect(manifest.proposals.rehome).toBe('.context/proposals/rehome-proposals.jsonl')
    expect(manifest.proposals.corrections).toBe('.context/proposals/corrections.jsonl')
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
    expect(manifest.runtime.providers).toBe('.context/runtime/providers')
    expect(manifest.runtime.tools).toBe('.context/tools')
    expect(manifest.runtime.skills).toEqual(expect.arrayContaining(['implementation', 'testing', 'review']))
    await expectFile(join(contextDir, 'runtime', 'agent-install-plan.json'))
    await expect(readFile(join(contextDir, 'indexes', 'global', 'fts.sqlite'), 'utf8')).resolves.toContain('SQLite format 3')

    const plan = JSON.parse(await readFile(join(contextDir, 'runtime', 'runtime-plan.json'), 'utf8')) as {
      schemaVersion: string
      capabilities: Array<{ id: string; kind: string; evidence: unknown[] }>
    }
    expect(plan.schemaVersion).toBe('context-runtime-plan.v1')
    expect(plan.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'context_task_implementation',
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
