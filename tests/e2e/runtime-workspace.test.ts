import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'
import { installMockGraphRagRuntimeHooks } from './mock-graphrag.js'

installMockGraphRagRuntimeHooks()

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
    await expectFile(join(contextDir, 'health.json'))
    await expect(access(join(contextDir, 'context-manifest.json'))).rejects.toThrow()
    await expectFile(join(contextDir, 'model', 'source-inventory.jsonl'))
    await expectFile(join(contextDir, 'model', 'source-routes.jsonl'))
    await expectFile(join(contextDir, 'model', 'unsupported-sources.jsonl'))
    await expectFile(join(contextDir, 'model', 'groups.jsonl'))
    await expectFile(join(contextDir, 'model', 'source-summary.json'))
    await expectFile(join(contextDir, 'model', 'packages.jsonl'))
    await expectFile(join(contextDir, 'model', 'build-units.jsonl'))
    await expectFile(join(contextDir, 'model', 'scopes.jsonl'))
    await expectFile(join(contextDir, 'model', 'claims.jsonl'))
    await expectFile(join(contextDir, 'store', 'source-map.jsonl'))
    await expectFile(join(contextDir, 'store', 'chunks.jsonl'))
    await expectFile(join(contextDir, 'graph', 'nodes.jsonl'))
    await expectFile(join(contextDir, 'graph', 'edges.jsonl'))
    await expectFile(join(contextDir, 'graph', 'revisions.jsonl'))
    await expectFile(join(contextDir, 'graph', 'patches.jsonl'))
    await expectFile(join(contextDir, 'graph', 'evidence-reports.jsonl'))
    await expectFile(join(contextDir, 'graph', 'subgraphs', 'code.nodes.jsonl'))
    await expectFile(join(contextDir, 'graph', 'subgraphs', 'api.nodes.jsonl'))
    await expect(access(join(contextDir, 'graph', 'subgraphs', 'source.nodes.jsonl'))).rejects.toThrow()
    await expectFile(join(contextDir, 'graph', 'partitions', 'domain', 'order.nodes.jsonl'))
    await expectFile(join(contextDir, 'index', 'global', 'symbols.sqlite'))
    await expectFile(join(contextDir, 'index', 'global', 'api.sqlite'))
    await expectFile(join(contextDir, 'index', 'global', 'fts.sqlite'))
    await expectFile(join(contextDir, 'model', 'plans', 'source-triage.json'))
    await expectFile(join(contextDir, 'model', 'plans', 'planning-pack.json'))
    await expectFile(join(contextDir, 'model', 'plans', 'planning-cycles.jsonl'))
    await expectFile(join(contextDir, 'model', 'plans', 'workspace-graph-plan.json'))
    await expectFile(join(contextDir, 'model', 'plans', 'scope-build-plan.json'))
    await expectFile(join(contextDir, 'state', 'rehome-proposals.jsonl'))
    await expectFile(join(contextDir, 'state', 'corrections.jsonl'))
    await expectFile(join(contextDir, 'runtime', 'runtime.config.json'))
    await expectFile(join(contextDir, 'runtime', 'runtime-plan.json'))
    await expectFile(join(contextDir, 'mcp', 'server.config.json'))
    await expectFile(join(contextDir, 'mcp', 'tools.json'))
    await expectFile(join(contextDir, 'mcp', 'resources.json'))
    await expectFile(join(contextDir, 'runtime', 'tools', 'context_task_implementation.json'))
    await expectFile(join(contextDir, 'runtime', 'skills', 'implementation.md'))
    await expectFile(join(contextDir, 'runtime', 'skills', 'testing.md'))
    await expectFile(join(contextDir, 'agents', 'codex', 'AGENTS.generated.md'))
    await expectFile(join(contextDir, 'agents', 'claude', 'CLAUDE.generated.md'))
    await expectFile(join(contextDir, 'agents', 'opencode', 'AGENTS.generated.md'))
    await expectFile(join(contextDir, 'runtime', 'plugins', 'context-compiler-local.json'))
    await expectFile(join(contextDir, 'debug', 'diagnostics', 'latest.jsonl'))
    await expectFile(join(contextDir, 'debug', 'project', 'brief.md'))
    await expectFile(join(contextDir, 'debug', 'domains', 'order.md'))
    await expectFile(join(contextDir, 'debug', 'reports', 'diagnostics.md'))
    await expectFile(join(contextDir, 'debug', 'views', 'implementation.md'))
    await expectFile(join(contextDir, 'packs', 'views', 'implementation.json'))
    await expect(access(join(contextDir, 'views'))).rejects.toThrow()
    await expect(access(join(contextDir, 'artifacts'))).rejects.toThrow()
    await expect(access(join(contextDir, 'indexes'))).rejects.toThrow()
    await expect(access(join(contextDir, 'sources'))).rejects.toThrow()
    await expect(access(join(contextDir, 'diagnostics'))).rejects.toThrow()
    await expect(access(join(contextDir, 'proposals'))).rejects.toThrow()
    await expect(access(join(contextDir, 'plans'))).rejects.toThrow()
    await expect(access(join(contextDir, 'tasks'))).rejects.toThrow()

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
      model: {
        sourceInventory: string
        sourceRoutes: string
        unsupportedSources: string
        sourceSummary: string
        groups: string
        packages: string
        buildUnits: string
        scopes: string
        claims: string
        groupingRequest: string
        plans: { workspaceGraph: string; planningPack: string; planningCycles: string }
      }
      store: { chunks: string; sourceMap: string; blobs: string }
      graph: { nodes: string; edges: string; subgraphs: string; partitions: string; revisions: string; patches: string; evidenceReports: string }
      index: { symbols: string; apis: string; fts: string }
      packs: { views: string; tasks: string }
      state: { rehomeProposals: string; corrections: string; groupingDecisions: string; sourceCorrectionDecisions: string }
      debug: { views: string; reports: string; projectBrief: string; domains: string }
    }
    expect(manifest.schemaVersion).toBe('context-runtime.v1')
    expect(manifest.model).toMatchObject({
      sourceInventory: '.context/model/source-inventory.jsonl',
      sourceRoutes: '.context/model/source-routes.jsonl',
      unsupportedSources: '.context/model/unsupported-sources.jsonl',
      sourceSummary: '.context/model/source-summary.json',
      groups: '.context/model/groups.jsonl',
      packages: '.context/model/packages.jsonl',
      buildUnits: '.context/model/build-units.jsonl',
      scopes: '.context/model/scopes.jsonl',
      claims: '.context/model/claims.jsonl',
      groupingRequest: '.context/model/grouping-request.json'
    })
    expect(manifest.store).toMatchObject({
      chunks: '.context/store/chunks.jsonl',
      sourceMap: '.context/store/source-map.jsonl',
      blobs: '.context/store/blobs'
    })
    expect(manifest.graph.nodes).toBe('.context/graph/nodes.jsonl')
    expect(manifest.graph.edges).toBe('.context/graph/edges.jsonl')
    expect(manifest.graph.subgraphs).toBe('.context/graph/subgraphs')
    expect(manifest.graph.partitions).toBe('.context/graph/partitions')
    expect(manifest.graph.revisions).toBe('.context/graph/revisions.jsonl')
    expect(manifest.graph.patches).toBe('.context/graph/patches.jsonl')
    expect(manifest.graph.evidenceReports).toBe('.context/graph/evidence-reports.jsonl')
    expect(manifest.index.fts).toBe('.context/index/global/fts.sqlite')
    expect(manifest.model.plans.workspaceGraph).toBe('.context/model/plans/workspace-graph-plan.json')
    expect(manifest.model.plans.planningPack).toBe('.context/model/plans/planning-pack.json')
    expect(manifest.model.plans.planningCycles).toBe('.context/model/plans/planning-cycles.jsonl')
    expect(manifest.state.rehomeProposals).toBe('.context/state/rehome-proposals.jsonl')
    expect(manifest.state.corrections).toBe('.context/state/corrections.jsonl')
    expect(manifest.packs.views).toBe('.context/packs/views')
    expect(manifest.packs.tasks).toBe('.context/packs/tasks')
    expect(manifest.debug.views).toBe('.context/debug/views')
    expect(manifest.runtime.plan).toBe('.context/runtime/runtime-plan.json')
    expect(manifest.runtime.trace).toBe('.context/runtime/trace.jsonl')
    expect(manifest.runtime.runSummary).toBe('.context/runtime/run-summary.json')
    expect(manifest.runtime.agentInstallPlan).toBe('.context/runtime/agent-install-plan.json')
    expect(manifest.runtime.freshness.status).toBe('fresh')
    expect(manifest.runtime.installStatus).toMatchObject({ codex: 'planned', claude: 'planned', opencode: 'planned' })
    expect(manifest.runtime.capabilitySurfaces.codex).toEqual(
      expect.arrayContaining(['AGENTS.md', '.codex/config.toml', '.agents/skills'])
    )
    expect(manifest.runtime.capabilitySurfaces.claude).toEqual(
      expect.arrayContaining(['CLAUDE.md', '.mcp.json', '.claude/skills'])
    )
    expect(manifest.runtime.capabilitySurfaces.opencode).toEqual(
      expect.arrayContaining(['AGENTS.md', 'opencode.json', '.opencode/skills'])
    )
    expect(manifest.runtime.providers).toBe('.context/runtime/providers')
    expect(manifest.runtime.tools).toBe('.context/runtime/tools')
    expect(manifest.runtime.skills).toEqual(expect.arrayContaining(['implementation', 'testing', 'review']))
    await expectFile(join(contextDir, 'runtime', 'agent-install-plan.json'))
    await expect(readFile(join(contextDir, 'index', 'global', 'fts.sqlite'), 'utf8')).resolves.toContain('SQLite format 3')

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
