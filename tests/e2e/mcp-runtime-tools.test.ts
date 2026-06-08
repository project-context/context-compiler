import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function jsonl<T>(content: string): T[] {
  return content.trim().length === 0 ? [] : content.trim().split('\n').map((line) => JSON.parse(line) as T)
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
    await expect(callContextMcpTool(rootDir, 'explain_capability', { capabilityId: 'context_compile' })).resolves.toMatchObject({
      data: { capability: expect.objectContaining({ id: 'context_compile', kind: 'project-tool' }) }
    })
    await expect(callContextMcpTool(rootDir, 'get_source_trace', { nodeId: 'REQ-ORDER-REFUND-001' })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-layered-source-trace.v1',
        fact: expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' }),
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({ uri: expect.stringContaining('docs/product/refund.md') })
        ]),
        scopes: expect.arrayContaining([expect.objectContaining({ kind: 'file' }), expect.objectContaining({ kind: 'content' })]),
        files: expect.arrayContaining([expect.objectContaining({ type: 'File' })]),
        contentNodes: expect.arrayContaining([expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' })])
      }
    })
    await expect(callContextMcpTool(rootDir, 'refresh_context', {})).resolves.toMatchObject({
      data: {
        refreshed: true,
        graph: expect.objectContaining({ nodes: expect.any(Number), edges: expect.any(Number) })
      }
    })
    await expect(callContextMcpTool(rootDir, 'get_planning_pack', {})).resolves.toMatchObject({
      data: { schemaVersion: 'context-planning-pack.v1' }
    })
    await expect(callContextMcpTool(rootDir, 'search_source_inventory', { query: 'refund' })).resolves.toMatchObject({
      data: { results: expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('refund.md') })]) }
    })
    await expect(callContextMcpTool(rootDir, 'search_context', { query: 'refund' })).resolves.toMatchObject({
      data: {
        engine: 'sqlite',
        indexPath: '.context/indexes/global/fts.sqlite',
        results: expect.arrayContaining([expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' })]),
        diagnostics: []
      }
    })
    const packageList = await callContextMcpTool(rootDir, 'list_context_packages', {}) as {
      data: { packages: Array<{ package: { id: string; path: string; kind: string } }> }
    }
    expect(packageList.data.packages).toEqual(
      expect.arrayContaining([expect.objectContaining({ package: expect.objectContaining({ path: 'docs/product' }) })])
    )
    const productPackage = packageList.data.packages.find((item) => item.package.path === 'docs/product')
    await expect(callContextMcpTool(rootDir, 'get_context_package', { packageRef: productPackage?.package.id })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-package-view.v1',
        package: expect.objectContaining({ path: 'docs/product' }),
        sourceGroups: expect.any(Array)
      }
    })
    await expect(callContextMcpTool(rootDir, 'expand_context_package', { packageRef: productPackage?.package.path, mode: 'full' })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-package-expansion.v1',
        facts: expect.arrayContaining([expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' })])
      }
    })
    await expect(callContextMcpTool(rootDir, 'search_context_package', { query: 'refund', packageRef: productPackage?.package.path })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-package-search.v1',
        results: expect.arrayContaining([expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' })])
      }
    })
    await expect(callContextMcpTool(rootDir, 'expand_graph_target', { targetId: 'REQ-ORDER-REFUND-001' })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-graph-expansion.v1',
        targetKind: 'node',
        target: expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' }),
        facts: expect.arrayContaining([expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' })]),
        sourceTrace: expect.objectContaining({ factId: 'REQ-ORDER-REFUND-001' })
      }
    })
    await expect(callContextMcpTool(rootDir, 'inspect_source_candidate', { path: 'docs/product' })).resolves.toMatchObject({
      data: { candidate: expect.objectContaining({ path: 'docs/product' }) }
    })
    await expect(callContextMcpTool(rootDir, 'list_graph_patches', {})).resolves.toMatchObject({
      data: { patches: expect.any(Array) }
    })
    await expect(callContextMcpTool(rootDir, 'get_rehome_proposals', {})).resolves.toMatchObject({
      data: { proposals: expect.any(Array) }
    })

    const revision = JSON.parse((await readFile(join(rootDir, '.context', 'graph', 'revisions', 'revisions.jsonl'), 'utf8')).trim()) as {
      id: string
      createdAt: string
    }
    const patch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:test-simulate',
      revisionId: revision.id,
      author: { type: 'agent', name: 'test' },
      status: 'proposed',
      createdAt: revision.createdAt,
      evidence: [],
      operations: [{ op: 'update_node', nodeId: 'REQ-ORDER-REFUND-001', properties: { reviewed: true } }]
    }
    await expect(
      callContextMcpTool(rootDir, 'simulate_graph_patch', { patch })
    ).resolves.toMatchObject({
      data: {
        simulated: true,
        graph: expect.objectContaining({ nodes: expect.any(Number), edges: expect.any(Number) })
      }
    })
    await expect(callContextMcpTool(rootDir, 'submit_graph_patch', { patch })).resolves.toMatchObject({
      data: { submitted: true, patchId: 'patch:test-simulate' }
    })
    await expect(callContextMcpTool(rootDir, 'list_graph_patches', {})).resolves.toMatchObject({
      data: {
        counts: expect.objectContaining({ inbox: 1 }),
        inbox: expect.arrayContaining([expect.objectContaining({ id: 'patch:test-simulate' })])
      }
    })
  })

  it('keeps submitted patches through compile and applies them through an explicit CLI cycle', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-patch-cycle-'))
    await writeRuntimeToolsProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    const [revision] = jsonl<{ id: string; createdAt: string }>(
      await readFile(join(rootDir, '.context', 'graph', 'revisions', 'revisions.jsonl'), 'utf8')
    )
    const patch = {
      schemaVersion: 'context-graph-patch.v1',
      id: 'patch:test-apply-cycle',
      revisionId: revision.id,
      author: { type: 'agent', name: 'test' },
      status: 'proposed',
      createdAt: revision.createdAt,
      evidence: [],
      operations: [
        {
          op: 'update_node',
          nodeId: 'REQ-ORDER-REFUND-001',
          properties: { kernelAppliedNeedle: 'batch-applied' }
        }
      ]
    }

    await expect(callContextMcpTool(rootDir, 'submit_graph_patch', { patch })).resolves.toMatchObject({
      data: { submitted: true, patchId: 'patch:test-apply-cycle' }
    })
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })
    await expect(readFile(join(rootDir, '.context', 'graph', 'patches', 'submitted.jsonl'), 'utf8')).resolves.toContain('patch:test-apply-cycle')

    const graphBeforeDryRun = await readFile(join(rootDir, '.context', 'graph', 'global', 'nodes.jsonl'), 'utf8')
    const dryRun = await runCli(['graph', 'apply-patches', '--dry-run'], { cwd: rootDir })
    expect(dryRun.exitCode).toBe(0)
    expect(dryRun.stdout).toContain('Dry run: true')
    expect(dryRun.stdout).toContain('Applied patches: 1')
    await expect(readFile(join(rootDir, '.context', 'graph', 'global', 'nodes.jsonl'), 'utf8')).resolves.toBe(graphBeforeDryRun)

    const apply = await runCli(['graph', 'apply-patches'], { cwd: rootDir })
    expect(apply.exitCode).toBe(0)
    expect(apply.stdout).toContain('Dry run: false')
    expect(apply.stdout).toContain('Applied patches: 1')
    await expect(readFile(join(rootDir, '.context', 'graph', 'global', 'nodes.jsonl'), 'utf8')).resolves.toContain('batch-applied')
    await expect(readFile(join(rootDir, '.context', 'graph', 'patches', 'submitted.jsonl'), 'utf8')).resolves.toBe('')

    const ledger = jsonl<{ id: string; status: string }>(await readFile(join(rootDir, '.context', 'graph', 'patches', 'patches.jsonl'), 'utf8'))
    expect(ledger).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'patch:test-apply-cycle', status: 'applied' })]))
    const revisions = jsonl<{ id: string; parentRevisionId?: string; patchIds: string[] }>(
      await readFile(join(rootDir, '.context', 'graph', 'revisions', 'revisions.jsonl'), 'utf8')
    )
    expect(revisions.at(-1)).toMatchObject({
      parentRevisionId: revision.id,
      patchIds: ['patch:test-apply-cycle']
    })

    const query = await runCli(['query', 'batch-applied'], { cwd: rootDir })
    expect(query.stdout).toContain('REQ-ORDER-REFUND-001')
  })

  it('applies evidence-derived parent graph corrections through the explicit patch cycle', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-evidence-cycle-'))
    await writeRuntimeToolsProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })

    const [revision] = jsonl<{ id: string; createdAt: string }>(
      await readFile(join(rootDir, '.context', 'graph', 'revisions', 'revisions.jsonl'), 'utf8')
    )
    const report = {
      schemaVersion: 'context-evidence-report.v1',
      id: 'evidence:refund-scope',
      revisionId: revision.id,
      scopeId: 'scope:source-group:docs-product',
      generatedAt: revision.createdAt,
      summary: 'Content graph confirmed the refund requirement and found a misplaced source.',
      findings: [
        {
          type: 'confirm_fact',
          nodeId: 'REQ-ORDER-REFUND-001',
          confidence: 0.97,
          evidence: [
            {
              type: 'explicit_reference',
              description: 'Requirement heading confirmed by content graph.',
              sourceRefs: [{ sourceId: 'product-docs', uri: 'file://docs/product/refund.md', location: { path: 'docs/product/refund.md' } }]
            }
          ]
        },
        {
          type: 'misplaced_source',
          sourcePath: 'docs/product/refund.md',
          suggestedPath: 'docs/refund/refund.md',
          confidence: 0.81,
          evidence: [
            {
              type: 'semantic_match',
              description: 'Refund-specific content should be considered for a future focused bundle.',
              sourceRefs: [{ sourceId: 'product-docs', uri: 'file://docs/product/refund.md', location: { path: 'docs/product/refund.md' } }]
            }
          ]
        }
      ],
      proposedPatches: [],
      rehomeProposals: []
    }
    await writeFile(join(rootDir, '.context', 'graph', 'evidence-reports.jsonl'), `${JSON.stringify(report)}\n`)

    await expect(callContextMcpTool(rootDir, 'list_evidence_reports', {})).resolves.toMatchObject({
      data: {
        counts: expect.objectContaining({ reports: 1, derivedPatches: 1 }),
        reports: expect.arrayContaining([expect.objectContaining({ id: 'evidence:refund-scope' })]),
        derivedPatches: expect.arrayContaining([expect.objectContaining({ id: 'PATCH-evidence-refund-scope', processed: false })])
      }
    })
    const correctionInbox = await callContextMcpTool(rootDir, 'list_package_corrections', { packageRef: 'docs/product' }) as {
      data: { proposals: Array<{ id: string; kind: string; status: string }>; counts: { total: number } }
    }
    expect(correctionInbox).toMatchObject({
      data: {
        schemaVersion: 'context-package-correction-inbox.v1',
        counts: expect.objectContaining({
          total: 2,
          blocked: expect.any(Number),
          conflicted: expect.any(Number),
          byRiskLevel: expect.any(Object)
        }),
        proposals: expect.arrayContaining([
          expect.objectContaining({
            kind: 'confirm_relation',
            status: 'proposed',
            dedupeKey: expect.any(String),
            blocked: expect.any(Boolean),
            operationPlan: expect.objectContaining({
              schemaVersion: 'context-correction-operation-plan.v1'
            }),
            impact: expect.objectContaining({ riskLevel: expect.any(String) }),
            conflicts: expect.any(Array)
          }),
          expect.objectContaining({
            kind: 'rehome',
            status: 'proposed',
            dedupeKey: expect.any(String),
            blocked: expect.any(Boolean),
            impact: expect.objectContaining({ riskLevel: expect.any(String) }),
            conflicts: expect.any(Array)
          })
        ])
      }
    })
    const confirmProposalId = correctionInbox.data.proposals.find((proposal) => proposal.kind === 'confirm_relation')?.id
    const rehomeProposalId = correctionInbox.data.proposals.find((proposal) => proposal.kind === 'rehome')?.id
    expect(confirmProposalId).toBeDefined()
    expect(rehomeProposalId).toBeDefined()
    if (!confirmProposalId || !rehomeProposalId) {
      throw new Error('expected package correction proposal ids')
    }
    await expect(callContextMcpTool(rootDir, 'get_correction_proposal', { proposalId: confirmProposalId })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-correction-proposal.v1',
        id: confirmProposalId,
        packageId: expect.any(String),
        graphPatchIds: ['PATCH-evidence-refund-scope'],
        dedupeKey: expect.any(String),
        operationPlan: expect.objectContaining({
          schemaVersion: 'context-correction-operation-plan.v1',
          kind: 'confirm_relation'
        }),
        impact: expect.objectContaining({ updates: 1 }),
        conflicts: expect.any(Array),
        blocked: expect.any(Boolean)
      }
    })
    await expect(callContextMcpTool(rootDir, 'preview_correction_proposal', { proposalId: confirmProposalId })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-correction-preview.v1',
        proposal: expect.objectContaining({ id: confirmProposalId }),
        operationPlan: expect.objectContaining({
          schemaVersion: 'context-correction-operation-plan.v1',
          kind: 'confirm_relation'
        }),
        revisionSummary: expect.objectContaining({
          appliedPatchIds: ['PATCH-evidence-refund-scope']
        })
      }
    })
    await expect(callContextMcpTool(rootDir, 'approve_correction_proposal', { proposalId: confirmProposalId, reason: 'confirmed by test' })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-correction-action-result.v1',
        action: 'approve',
        proposal: expect.objectContaining({ id: confirmProposalId, status: 'approved', statusReason: 'confirmed by test' })
      }
    })
    await expect(callContextMcpTool(rootDir, 'apply_correction_proposal', { proposalId: confirmProposalId, dryRun: true })).resolves.toMatchObject({
      data: {
        action: 'apply',
        dryRun: true,
        written: false,
        submitted: false,
        graphPatch: expect.objectContaining({ id: 'PATCH-evidence-refund-scope' }),
        preview: expect.objectContaining({ schemaVersion: 'context-correction-preview.v1' }),
        operationPlan: expect.objectContaining({ kind: 'confirm_relation' }),
        diagnostics: expect.any(Array)
      }
    })
    await expect(callContextMcpTool(rootDir, 'reject_correction_proposal', { proposalId: rehomeProposalId, reason: 'defer rehome' })).resolves.toMatchObject({
      data: {
        action: 'reject',
        proposal: expect.objectContaining({ id: rehomeProposalId, status: 'rejected', statusReason: 'defer rehome' })
      }
    })
    const evidenceList = await runCli(['graph', 'evidence'], { cwd: rootDir })
    expect(evidenceList.exitCode).toBe(0)
    expect(evidenceList.stdout).toContain('evidence:refund-scope')
    expect(evidenceList.stdout).toContain('PATCH-evidence-refund-scope')

    await expect(callContextMcpTool(rootDir, 'list_graph_patches', {})).resolves.toMatchObject({
      data: {
        counts: expect.objectContaining({ evidence: 1 }),
        evidence: expect.arrayContaining([expect.objectContaining({ id: 'PATCH-evidence-refund-scope' })])
      }
    })

    const graphBeforeDryRun = await readFile(join(rootDir, '.context', 'graph', 'global', 'nodes.jsonl'), 'utf8')
    const dryRun = await runCli(['graph', 'apply-patches', '--dry-run'], { cwd: rootDir })
    expect(dryRun.exitCode).toBe(0)
    expect(dryRun.stdout).toContain('Dry run: true')
    expect(dryRun.stdout).toContain('Evidence patches: 1')
    expect(dryRun.stdout).toContain('Applied patches: 1')
    await expect(readFile(join(rootDir, '.context', 'graph', 'global', 'nodes.jsonl'), 'utf8')).resolves.toBe(graphBeforeDryRun)

    const apply = await runCli(['graph', 'apply-patches'], { cwd: rootDir })
    expect(apply.exitCode).toBe(0)
    expect(apply.stdout).toContain('Dry run: false')
    expect(apply.stdout).toContain('Evidence patches: 1')
    expect(apply.stdout).toContain('Applied patches: 1')
    await expect(readFile(join(rootDir, '.context', 'graph', 'global', 'nodes.jsonl'), 'utf8')).resolves.toContain('"status":"confirmed"')

    const ledger = jsonl<{ id: string; status: string }>(await readFile(join(rootDir, '.context', 'graph', 'patches', 'patches.jsonl'), 'utf8'))
    expect(ledger).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'PATCH-evidence-refund-scope', status: 'applied' })]))
    await expect(callContextMcpTool(rootDir, 'explain_graph_fact', { factId: 'REQ-ORDER-REFUND-001' })).resolves.toMatchObject({
      data: {
        factKind: 'node',
        budget: expect.objectContaining({ mode: 'summary' }),
        patches: expect.arrayContaining([expect.objectContaining({ id: 'PATCH-evidence-refund-scope', status: 'applied' })]),
        evidenceReports: expect.arrayContaining([expect.objectContaining({ id: 'evidence:refund-scope' })]),
        provenance: expect.arrayContaining([
          expect.objectContaining({
            patchId: 'PATCH-evidence-refund-scope',
            operation: 'update_node',
            findingTypes: ['confirm_fact']
          })
        ])
      }
    })
    await expect(callContextMcpTool(rootDir, 'explain_graph_fact', { factId: 'REQ-ORDER-REFUND-001', mode: 'full' })).resolves.toMatchObject({
      data: {
        budget: { mode: 'full' },
        omitted: { sourceRefs: 0, evidence: 0, relations: 0, provenance: 0 }
      }
    })
    await expect(callContextMcpTool(rootDir, 'get_graph_fact_history', { factId: 'REQ-ORDER-REFUND-001' })).resolves.toMatchObject({
      data: {
        factKind: 'node',
        timeline: expect.arrayContaining([
          expect.objectContaining({ operation: 'compile_seed' }),
          expect.objectContaining({ operation: 'update_node', patchId: 'PATCH-evidence-refund-scope', findingTypes: ['confirm_fact'] })
        ])
      }
    })
    const proposals = jsonl<{ sourcePath: string; action: string }>(await readFile(join(rootDir, '.context', 'proposals', 'rehome-proposals.jsonl'), 'utf8'))
    expect(proposals).toEqual(expect.arrayContaining([expect.objectContaining({ sourcePath: 'docs/product/refund.md', action: 'keep' })]))
    await expect(readFile(join(rootDir, 'docs', 'product', 'refund.md'), 'utf8')).resolves.toContain('Support partial refund')
  })

  it('falls back when the SQLite FTS index is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'context-mcp-search-fallback-'))
    await writeRuntimeToolsProject(rootDir)
    await expect(runCli(['compile'], { cwd: rootDir })).resolves.toMatchObject({ exitCode: 0 })
    await rm(join(rootDir, '.context', 'indexes', 'global', 'fts.sqlite'), { force: true })

    await expect(callContextMcpTool(rootDir, 'search_context', { query: 'refund' })).resolves.toMatchObject({
      data: {
        engine: 'memory-fallback',
        results: expect.arrayContaining([expect.objectContaining({ id: 'REQ-ORDER-REFUND-001' })]),
        diagnostics: expect.arrayContaining([expect.objectContaining({ type: 'search.index.missing' })])
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
    expect(tools.find((tool) => tool.name === 'list_context_packages')?.inputSchema).toMatchObject({
      type: 'object'
    })
    expect(tools.find((tool) => tool.name === 'get_context_package')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        packageRef: { type: 'string' }
      },
      required: ['packageRef']
    })
    expect(tools.find((tool) => tool.name === 'expand_context_package')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        packageRef: { type: 'string' },
        mode: { type: 'string' }
      },
      required: ['packageRef']
    })
    expect(tools.find((tool) => tool.name === 'search_context_package')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string' },
        packageRef: { type: 'string' }
      },
      required: ['query']
    })
    expect(tools.find((tool) => tool.name === 'list_package_corrections')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        packageRef: { type: 'string' },
        status: { type: 'string' },
        kind: { type: 'string' }
      }
    })
    expect(tools.find((tool) => tool.name === 'get_correction_proposal')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        proposalId: { type: 'string' }
      },
      required: ['proposalId']
    })
    expect(tools.find((tool) => tool.name === 'preview_correction_proposal')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        proposalId: { type: 'string' }
      },
      required: ['proposalId']
    })
    expect(tools.find((tool) => tool.name === 'approve_correction_proposal')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        proposalId: { type: 'string' },
        reason: { type: 'string' }
      },
      required: ['proposalId']
    })
    expect(tools.find((tool) => tool.name === 'apply_correction_proposal')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        proposalId: { type: 'string' },
        dryRun: { type: 'boolean' }
      },
      required: ['proposalId']
    })
    expect(tools.find((tool) => tool.name === 'explain_capability')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        capabilityId: { type: 'string' }
      },
      required: ['capabilityId']
    })
    expect(tools.find((tool) => tool.name === 'simulate_graph_patch')?.inputSchema).toMatchObject({
      type: 'object',
      required: ['patch']
    })
    expect(tools.find((tool) => tool.name === 'expand_graph_target')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        targetId: { type: 'string' },
        depth: { type: 'number' }
      },
      required: ['targetId']
    })
    expect(tools.find((tool) => tool.name === 'get_source_trace')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        factId: { type: 'string' },
        limitSources: { type: 'number' }
      },
      required: ['factId']
    })
    expect(tools.find((tool) => tool.name === 'explain_graph_fact')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        factId: { type: 'string' },
        limitSources: { type: 'number' }
      },
      required: ['factId']
    })
    expect(tools.find((tool) => tool.name === 'get_graph_fact_history')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        factId: { type: 'string' }
      },
      required: ['factId']
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
    expect(initialized.result.instructions).toContain('docs/architecture/super-data-network-goal.md')
    expect(initialized.result.instructions).toContain('package-first')
    expect(initialized.result.instructions).toContain('list_package_corrections')
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
