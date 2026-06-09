import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '@context-compiler/cli'
import { callContextMcpTool } from '@context-compiler/mcp-server'
import { installMockGraphRagRuntimeHooks } from './mock-graphrag.js'

installMockGraphRagRuntimeHooks()

const rootDir = process.cwd()

function jsonl<T>(content: string): T[] {
  return content.trim().length === 0 ? [] : content.trim().split('\n').map((line) => JSON.parse(line) as T)
}

async function writeLocalSbtGroupingDecisions(cwd: string): Promise<void> {
  await mkdir(join(cwd, '.context', 'state'), { recursive: true })
  await writeFile(
    join(cwd, '.context', 'state', 'grouping-decisions.json'),
    `${JSON.stringify(
      {
        schemaVersion: 'context-source-grouping-decisions.v1',
        generatedAt: '2026-06-08T00:00:00.000Z',
        agent: 'fixture',
        decisions: [
          {
            path: 'sources/mjsbt-manage-fe',
            kind: 'repository',
            boundaryMode: 'repository',
            title: 'mjsbt-manage-fe',
            summary: 'Frontend management repository.',
            childrenPolicy: 'promote_routed',
            confidence: 0.95
          },
          {
            path: 'sources/product-docs',
            kind: 'doc_bundle',
            boundaryMode: 'collapsed',
            title: 'Product Documentation',
            summary: 'Product documentation bundle.',
            childrenPolicy: 'promote_routed',
            confidence: 0.95
          }
        ]
      },
      null,
      2
    )}\n`
  )
}

describe('source-first auto discovery', () => {
  it('compiles local-sbt from an untyped source root and emits source inventory', async () => {
    const cwd = join(rootDir, 'examples', 'local-sbt')
    await writeLocalSbtGroupingDecisions(cwd)
    const config = JSON.parse(await readFile(join(cwd, 'context.config.json'), 'utf8')) as {
      sources: Array<{ name: string; path: string; type?: string }>
    }
    expect(config.sources).toEqual([{ name: 'workspace', path: './sources' }])

    const previousRuntime = process.env.CONTEXT_GRAPHRAG_RUNTIME
    process.env.CONTEXT_GRAPHRAG_RUNTIME = 'mock'
    try {
      const compile = await runCli(['compile'], { cwd })
      expect(compile.exitCode).toBe(0)
    } finally {
      if (previousRuntime === undefined) {
        delete process.env.CONTEXT_GRAPHRAG_RUNTIME
      } else {
        process.env.CONTEXT_GRAPHRAG_RUNTIME = previousRuntime
      }
    }

    const manifest = JSON.parse(await readFile(join(cwd, '.context', 'manifest.json'), 'utf8')) as {
      model: {
        sourceInventory: string
        groups: string
        packages: string
        buildUnits: string
        groupingRequest: string
        plans: {
          sourceTriage: string
          sourceGroups: string
          workspaceGraph: string
          scopeBuild: string
          adapterPlan: string
        }
      }
      index: {
        graph: string
        fts: string
        scopes: string
      }
      state: {
        groupingDecisions: string
        sourceCorrectionDecisions: string
      }
    }
    expect(manifest.model).toMatchObject({
      sourceInventory: '.context/model/source-inventory.jsonl',
      groups: '.context/model/groups.jsonl',
      packages: '.context/model/packages.jsonl',
      buildUnits: '.context/model/build-units.jsonl',
      groupingRequest: '.context/model/grouping-request.json'
    })
    expect(manifest.model.plans).toMatchObject({
      sourceTriage: '.context/model/plans/source-triage.json',
      sourceGroups: '.context/model/plans/source-group-plan.json',
      workspaceGraph: '.context/model/plans/workspace-graph-plan.json',
      scopeBuild: '.context/model/plans/scope-build-plan.json',
      adapterPlan: '.context/model/plans/adapter-plan.json'
    })
    expect(manifest.index).toMatchObject({
      graph: '.context/index/global/graph.sqlite',
      fts: '.context/index/global/fts.sqlite',
      scopes: '.context/index/scopes'
    })
    expect(manifest.state).toMatchObject({
      groupingDecisions: '.context/state/grouping-decisions.json',
      sourceCorrectionDecisions: '.context/state/source-correction-decisions.jsonl'
    })

    const inventory = jsonl<{
      path: string
      mediaType: string
      route: string
      status: string
      unsupportedReason?: string
    }>(await readFile(join(cwd, '.context', 'model', 'source-inventory.jsonl'), 'utf8'))
    expect(inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringMatching(/product-docs\/.*\.md$/), route: 'markdown', status: 'routed' }),
        expect.objectContaining({ path: 'sources/mjsbt-manage-fe/src/app.tsx', route: 'code', status: 'routed' }),
        expect.objectContaining({ path: 'sources/mjsbt-manage-fe/.umirc.ts', route: 'code', status: 'routed' }),
        expect.objectContaining({ path: 'sources/mjsbt-manage-fe/package.json', route: 'inventory', status: 'inventory_only' }),
        expect.objectContaining({
          path: 'sources/mjsbt-manage-fe/public/favicon.ico',
          mediaType: 'image/x-icon',
          route: 'unsupported',
          status: 'unsupported',
          unsupportedReason: 'adapter-not-configured'
        }),
        expect.objectContaining({ path: 'sources/mjsbt-manage-fe/yarn.lock', route: 'inventory', status: 'inventory_only' })
      ])
    )

    const unsupported = jsonl<{ path: string }>(await readFile(join(cwd, '.context', 'model', 'unsupported-sources.jsonl'), 'utf8'))
    expect(unsupported).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'sources/mjsbt-manage-fe/public/favicon.ico' })]))

    const groups = jsonl<{ path: string; kind: string; boundaryMode: string; title: string }>(
      await readFile(join(cwd, '.context', 'model', 'groups.jsonl'), 'utf8')
    )
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sources/mjsbt-manage-fe', kind: 'repository', boundaryMode: 'repository' }),
        expect.objectContaining({ path: 'sources/product-docs', kind: 'doc_bundle', boundaryMode: 'collapsed' })
      ])
    )
    const packages = jsonl<{ path: string; kind: string; buildUnits: Array<{ standardKind: string; adapterId: string; adapterSelection: { selectionSource?: string } }> }>(
      await readFile(join(cwd, '.context', 'model', 'packages.jsonl'), 'utf8')
    )
    expect(packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sources/mjsbt-manage-fe',
          kind: 'code_repository',
          buildUnits: [
            expect.objectContaining({
              standardKind: 'repository',
              adapterId: 'codegraph.graph-adapter',
              adapterSelection: expect.objectContaining({ selectionSource: 'default' })
            })
          ]
        }),
        expect.objectContaining({
          path: 'sources/product-docs',
          kind: 'product_docs',
          buildUnits: [
            expect.objectContaining({
              standardKind: 'semantic_corpus',
              adapterId: 'microsoft-graphrag.graph-adapter',
              adapterSelection: expect.objectContaining({ selectionSource: 'default' })
            })
          ]
        })
      ])
    )
    const buildUnits = jsonl<{ standardKind: string; adapterId: string }>(await readFile(join(cwd, '.context', 'model', 'build-units.jsonl'), 'utf8'))
    expect(buildUnits.map((unit) => unit.adapterId)).toEqual(expect.arrayContaining(['codegraph.graph-adapter', 'microsoft-graphrag.graph-adapter']))
    await expect(readFile(join(cwd, '.context', 'state', 'grouping-decisions.json'), 'utf8')).resolves.toContain(
      'context-source-grouping-decisions.v1'
    )
    await expect(readFile(join(cwd, '.context', 'model', 'plans', 'source-triage.json'), 'utf8')).resolves.toContain(
      'context-source-triage.v1'
    )
    await expect(readFile(join(cwd, '.context', 'model', 'plans', 'workspace-graph-plan.json'), 'utf8')).resolves.toContain(
      'context-workspace-graph-plan.v1'
    )
    await expect(readFile(join(cwd, '.context', 'model', 'plans', 'scope-build-plan.json'), 'utf8')).resolves.toContain(
      'scope:package:PACKAGE-workspace-sources-mjsbt-manage-fe'
    )
    const ftsHeader = (await readFile(join(cwd, '.context', 'index', 'global', 'fts.sqlite'))).subarray(0, 15).toString('utf8')
    expect(ftsHeader).toBe('SQLite format 3')

    const graphNodes = jsonl<{ id: string; type: string; name: string; properties?: Record<string, unknown> }>(
      await readFile(join(cwd, '.context', 'graph', 'nodes.jsonl'), 'utf8')
    )
    expect(graphNodes.map((node) => node.type)).toEqual(expect.arrayContaining(['Source', 'Package', 'SourceGroup', 'SourceSnapshot', 'Requirement', 'CodeSymbol', 'Document']))
    expect(graphNodes.filter((node) => node.type === 'SourceSnapshot').length).toBeLessThan(25)
    expect(graphNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'Package', properties: expect.objectContaining({ packageKind: 'product_docs', path: 'sources/product-docs' }) }),
        expect.objectContaining({ type: 'Package', properties: expect.objectContaining({ packageKind: 'code_repository', path: 'sources/mjsbt-manage-fe' }) })
      ])
    )
    expect(
      graphNodes.find((node) =>
        node.type === 'SourceGroup' &&
        node.properties?.kind === 'repository' &&
        node.properties?.path === 'sources/mjsbt-manage-fe'
      )
    ).toBeDefined()
    const graphEdges = jsonl<{ id: string; type: string; from: string; to: string }>(
      await readFile(join(cwd, '.context', 'graph', 'edges.jsonl'), 'utf8')
    )
    expect(graphEdges.map((edge) => edge.type)).toEqual(expect.arrayContaining(['contains_package', 'contains_source_group']))
    expect(graphEdges.map((edge) => edge.type)).not.toContain('related_to_group')
    await expect(readFile(join(cwd, '.context', 'graph', 'subgraphs', 'source-groups', 'SOURCE-GROUP-workspace-sources-mjsbt-manage-fe', 'nodes.jsonl'), 'utf8')).resolves.toContain(
      'SYM-index-ts-uploadFileAPI'
    )

    const evidenceReports = jsonl<{
      id: string
      findings: Array<{ type: string; nodeId?: string; targetGroupId?: string }>
    }>(await readFile(join(cwd, '.context', 'graph', 'evidence-reports.jsonl'), 'utf8'))
    expect(evidenceReports).toEqual([])

    const patchDryRun = await runCli(['graph', 'apply-patches', '--dry-run'], { cwd })
    expect(patchDryRun.exitCode).toBe(0)
    expect(patchDryRun.stdout).toContain('Evidence patches: 0')

    const scopeManifest = JSON.parse(await readFile(join(cwd, '.context', 'graph', 'scopes', 'manifest.json'), 'utf8')) as {
      scopes: Array<{ id: string; kind: string; parentScopeId?: string; path?: string; sourceGroupId?: string; rootNodeId?: string; adapterRefs?: Array<{ adapterId: string; role: string }> }>
    }
    const symbolFilePath = 'sources/mjsbt-manage-fe/src/services/benefitManage/index.ts'
    const repositoryScope = scopeManifest.scopes.find((scope) => scope.kind === 'source_group' && scope.path === 'sources/mjsbt-manage-fe')
    const repositoryPackageScope = scopeManifest.scopes.find((scope) => scope.kind === 'package' && scope.rootNodeId === 'PACKAGE-workspace-sources-mjsbt-manage-fe')
    const productPackageScope = scopeManifest.scopes.find((scope) => scope.kind === 'package' && scope.rootNodeId === 'PACKAGE-workspace-sources-product-docs')
    const symbolFileScope = scopeManifest.scopes.find((scope) => scope.kind === 'file' && scope.path === symbolFilePath)
    const symbolContentScope = scopeManifest.scopes.find((scope) => scope.kind === 'content' && scope.path === `${symbolFilePath}#content`)
    const docScope = scopeManifest.scopes.find((scope) => scope.kind === 'source_group' && scope.path === 'sources/product-docs')
    const repositoryBuildGraphScope = scopeManifest.scopes.find((scope) => scope.kind === 'build_graph' && scope.sourceGroupId === repositoryScope?.sourceGroupId)
    const docBuildGraphScope = scopeManifest.scopes.find((scope) => scope.kind === 'build_graph' && scope.sourceGroupId === docScope?.sourceGroupId)
    const docFileScope = scopeManifest.scopes.find((scope) => scope.kind === 'file' && scope.path?.startsWith('sources/product-docs/') && scope.path.endsWith('.md'))
    const docContentScope = scopeManifest.scopes.find((scope) => scope.kind === 'content' && scope.path?.startsWith('sources/product-docs/') && scope.path.endsWith('.md#content'))

    expect(repositoryPackageScope).toMatchObject({ parentScopeId: 'scope:project' })
    expect(productPackageScope).toMatchObject({ parentScopeId: 'scope:project' })
    expect(repositoryScope).toMatchObject({ parentScopeId: repositoryPackageScope?.id })
    expect(docScope).toMatchObject({ parentScopeId: productPackageScope?.id })
    expect(repositoryBuildGraphScope).toMatchObject({ parentScopeId: repositoryScope?.id })
    expect(docBuildGraphScope).toMatchObject({ parentScopeId: docScope?.id })
    expect(symbolFileScope).toMatchObject({ parentScopeId: repositoryBuildGraphScope?.id })
    expect(symbolContentScope).toMatchObject({ parentScopeId: symbolFileScope?.id })
    expect(docFileScope).toMatchObject({ parentScopeId: docBuildGraphScope?.id })
    expect(docContentScope).toMatchObject({ parentScopeId: docFileScope?.id })
    expect(repositoryScope?.adapterRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ adapterId: 'codegraph.graph-adapter', role: 'code-graph-builder' })])
    )
    expect(docScope?.adapterRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ adapterId: 'microsoft-graphrag.graph-adapter', role: 'semantic-graph-builder' })])
    )
    await expect(
      readFile(
        join(
          cwd,
          '.context',
          'extensions',
          'codegraph.graph-adapter',
          'artifacts',
          'scope-source-group-SOURCE-GROUP-workspace-sources-mjsbt-manage-fe',
          'summary.json'
        ),
        'utf8'
      )
    ).resolves.toContain('codegraph.graph-adapter')
    await expect(
      readFile(
        join(
          cwd,
          '.context',
          'graph',
          'scopes',
          'scope-source-group-SOURCE-GROUP-workspace-sources-product-docs',
          'summary.json'
        ),
        'utf8'
      )
    ).resolves.toContain('microsoft-graphrag.graph-adapter')

    const scopeCli = await runCli(['graph', 'scope', docScope?.id ?? ''], { cwd })
    expect(scopeCli.exitCode).toBe(0)
    expect(scopeCli.stdout).toContain('SemanticCorpusGraph')
    expect(scopeCli.stdout).not.toContain('MARKDOWN-DOC')
    expect(scopeCli.stdout).not.toContain('【原稿】商保通平台介绍')
    expect(scopeCli.stdout).toContain('Nodes:')
    expect(scopeCli.stdout).not.toContain('SourceSnapshot')

    const buildGraphScopeCli = await runCli(['graph', 'scope', docBuildGraphScope?.id ?? ''], { cwd })
    expect(buildGraphScopeCli.exitCode).toBe(0)
    expect(buildGraphScopeCli.stdout).toContain('MARKDOWN-DOC')
    expect(buildGraphScopeCli.stdout).toContain('【原稿】商保通平台介绍')
    expect(buildGraphScopeCli.stdout).toContain('Nodes:')
    expect(buildGraphScopeCli.stdout).not.toContain('SourceSnapshot')

    const groupExpansionCli = await runCli(['graph', 'expand', 'SOURCE-GROUP-workspace-sources-product-docs'], { cwd })
    expect(groupExpansionCli.exitCode).toBe(0)
    expect(groupExpansionCli.stdout).toContain('Product Documentation')
    expect(groupExpansionCli.stdout).toContain('SOURCE-GROUP-workspace-sources-product-docs')
    expect(groupExpansionCli.stdout).not.toContain('related_to_group')

    const packageListCli = await runCli(['package', 'list'], { cwd })
    expect(packageListCli.exitCode).toBe(0)
    expect(packageListCli.stdout).toContain('PACKAGE-workspace-sources-product-docs')
    expect(packageListCli.stdout).toContain('PACKAGE-workspace-sources-mjsbt-manage-fe')
    expect(packageListCli.stdout).toContain('microsoft-graphrag.graph-adapter')

    const packageShowCli = await runCli(['package', 'show', 'sources/product-docs'], { cwd })
    expect(packageShowCli.exitCode).toBe(0)
    expect(packageShowCli.stdout).toContain('Package:')
    expect(packageShowCli.stdout).toContain('SOURCE-GROUP-workspace-sources-product-docs')
    expect(packageShowCli.stdout).toContain('semantic_corpus')

    const packageExpansionCli = await runCli(['package', 'expand', 'PACKAGE-workspace-sources-product-docs', '--full'], { cwd })
    expect(packageExpansionCli.exitCode).toBe(0)
    expect(packageExpansionCli.stdout).toContain('MARKDOWN-DOC')
    expect(packageExpansionCli.stdout).toContain('sources/product-docs')

    const packageSearchCli = await runCli(['package', 'search', 'uploadFileAPI', '--package', 'sources/mjsbt-manage-fe'], { cwd })
    expect(packageSearchCli.exitCode).toBe(0)
    expect(packageSearchCli.stdout).toContain('SYM-index-ts-uploadFileAPI')
    expect(packageSearchCli.stdout).not.toContain('MARKDOWN-DOC')

    const repositoryExpansion = await callContextMcpTool(cwd, 'expand_graph_scope', { scopeId: symbolFileScope?.parentScopeId }) as {
      data: { nodes: Array<{ id: string; type: string; properties: Record<string, unknown> }>; edges: Array<{ type: string; to: string; properties: Record<string, unknown> }> }
    }
    const symbolFileNode = repositoryExpansion.data.nodes.find((node) => node.type === 'File' && node.properties.path === symbolFilePath)
    expect(symbolFileNode).toBeDefined()
    expect(repositoryExpansion.data.nodes.some((node) => node.type === 'SourceSnapshot')).toBe(false)
    expect(repositoryExpansion.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'has_child_scope',
          to: symbolFileNode?.id,
          properties: expect.objectContaining({ childScopeId: symbolFileScope?.id })
        })
      ])
    )

    const symbolFileExpansion = await callContextMcpTool(cwd, 'expand_graph_scope', { scopeId: symbolFileScope?.id }) as {
      data: { nodes: Array<{ type: string }>; edges: Array<{ type: string; properties: Record<string, unknown> }> }
    }
    expect(symbolFileExpansion.data.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(['File', 'SourceSnapshot', 'CodeSymbol']))
    expect(symbolFileExpansion.data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'has_child_scope',
          properties: expect.objectContaining({ childScopeId: symbolContentScope?.id })
        })
      ])
    )

    const docContentExpansion = await callContextMcpTool(cwd, 'expand_graph_scope', { scopeId: docContentScope?.id }) as {
      data: { nodes: Array<{ type: string }> }
    }
    expect(docContentExpansion.data.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(['File', 'SourceSnapshot', 'Requirement']))

    const productExpansion = await callContextMcpTool(cwd, 'expand_graph_target', { targetId: 'SOURCE-GROUP-workspace-sources-product-docs' }) as {
      data: { relatedScopes?: unknown[]; nextActions: Array<{ type: string; targetId: string }>; edges: Array<{ type: string }> }
    }
    expect(productExpansion.data.nextActions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'open_scope', targetId: repositoryScope?.id })])
    )
    expect(productExpansion.data.edges).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'related_to_group' })]))

    const symbolExpansion = await callContextMcpTool(cwd, 'expand_graph_target', { targetId: 'SYM-index-ts-uploadFileAPI' }) as {
      data: { nextActions: Array<{ type: string; targetId: string }> }
    }
    expect(symbolExpansion.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'open_scope', targetId: symbolFileScope?.id }),
        expect.objectContaining({ type: 'open_scope', targetId: symbolContentScope?.id })
      ])
    )

    const view = await runCli(['view', 'implementation'], { cwd })
    expect(view.exitCode).toBe(0)
    expect(view.stdout).toContain('Implementation Context')
    expect(view.stdout).toContain('Source Group')
    expect(view.stdout).toContain('mjsbt-manage-fe')
    expect(view.stdout).not.toContain('SourceSnapshot')

    const productQuery = await runCli(['query', '商保通'], { cwd })
    expect(productQuery.stdout).toContain('Requirement')
    const codeQuery = await runCli(['query', 'uploadFileAPI'], { cwd })
    expect(codeQuery.stdout).toContain('CodeSymbol')
    const packageListMcp = await callContextMcpTool(cwd, 'list_context_packages') as {
      data: { packages: Array<{ package: { id: string; path: string } }> }
    }
    expect(packageListMcp.data.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ package: expect.objectContaining({ id: 'PACKAGE-workspace-sources-product-docs', path: 'sources/product-docs' }) }),
        expect.objectContaining({ package: expect.objectContaining({ id: 'PACKAGE-workspace-sources-mjsbt-manage-fe', path: 'sources/mjsbt-manage-fe' }) })
      ])
    )
    await expect(callContextMcpTool(cwd, 'get_context_package', { packageRef: 'sources/product-docs' })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-package-view.v1',
        package: expect.objectContaining({ id: 'PACKAGE-workspace-sources-product-docs' }),
        sourceGroups: expect.arrayContaining([expect.objectContaining({ id: 'SOURCE-GROUP-workspace-sources-product-docs' })])
      }
    })
    await expect(callContextMcpTool(cwd, 'expand_context_package', { packageRef: 'PACKAGE-workspace-sources-product-docs', mode: 'full' })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-package-expansion.v1',
        facts: expect.arrayContaining([expect.objectContaining({ id: 'MARKDOWN-DOC' })])
      }
    })
    await expect(callContextMcpTool(cwd, 'search_context_package', { query: 'uploadFileAPI', packageRef: 'sources/mjsbt-manage-fe' })).resolves.toMatchObject({
      data: {
        schemaVersion: 'context-package-search.v1',
        results: expect.arrayContaining([expect.objectContaining({ id: 'SYM-index-ts-uploadFileAPI' })])
      }
    })
    const scopedCodeQuery = await callContextMcpTool(cwd, 'search_context', { query: 'uploadFileAPI', scopeId: symbolFileScope?.parentScopeId })
    expect(scopedCodeQuery).toMatchObject({
      data: {
        scopeId: symbolFileScope?.parentScopeId,
        engine: 'sqlite',
        indexPath: expect.stringContaining('.context/index/scopes/'),
        results: expect.arrayContaining([expect.objectContaining({ id: 'SYM-index-ts-uploadFileAPI', type: 'CodeSymbol' })])
      }
    })

    const productTrace = await callContextMcpTool(cwd, 'get_source_trace', { nodeId: 'MARKDOWN-DOC' })
    expect(productTrace).toMatchObject({
      data: {
        schemaVersion: 'context-layered-source-trace.v1',
        fact: expect.objectContaining({ id: 'MARKDOWN-DOC' }),
        sourceGroups: expect.arrayContaining([
          expect.objectContaining({ properties: expect.objectContaining({ kind: 'doc_bundle', path: 'sources/product-docs' }) })
        ]),
        scopes: expect.arrayContaining([expect.objectContaining({ kind: 'content' })]),
        files: expect.arrayContaining([expect.objectContaining({ type: 'File' })]),
        contentNodes: expect.arrayContaining([expect.objectContaining({ id: 'MARKDOWN-DOC' })])
      }
    })
    const codeTrace = await callContextMcpTool(cwd, 'get_source_trace', { nodeId: 'SYM-index-ts-uploadFileAPI' })
    expect(codeTrace).toMatchObject({
      data: {
        sourceGroups: expect.arrayContaining([
          expect.objectContaining({ properties: expect.objectContaining({ kind: 'repository', path: 'sources/mjsbt-manage-fe' }) })
        ]),
        scopes: expect.arrayContaining([expect.objectContaining({ kind: 'content' })]),
        files: expect.arrayContaining([expect.objectContaining({ type: 'File' })])
      }
    })
    const traceCli = await runCli(['graph', 'trace', 'MARKDOWN-DOC'], { cwd })
    expect(traceCli.exitCode).toBe(0)
    expect(traceCli.stdout).toContain('MARKDOWN-DOC')
    expect(traceCli.stdout).toContain('Sources:')
  }, 90000)

  it('compiles noninteractive auto sources with inferred child package groups when no agent writes grouping decisions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context-source-grouping-cli-'))
    await mkdir(join(cwd, 'sources', 'docs'), { recursive: true })
    await writeFile(join(cwd, 'context.config.json'), JSON.stringify({ sources: [{ name: 'workspace', path: './sources' }] }, null, 2))
    await writeFile(join(cwd, 'sources', 'docs', 'product.md'), '# Product\n')

    const compile = await runCli(['compile'], { cwd })
    expect(compile.exitCode).toBe(0)
    const request = JSON.parse(await readFile(join(cwd, '.context', 'model', 'grouping-request.json'), 'utf8')) as {
      schemaVersion: string
      sources: Array<{ candidates: Array<{ path: string }> }>
    }
    expect(request.schemaVersion).toBe('context-source-grouping-request.v1')
    expect(request.sources[0].candidates).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'sources' })]))
    const decisions = JSON.parse(await readFile(join(cwd, '.context', 'state', 'grouping-decisions.json'), 'utf8')) as {
      agent?: string
      decisions: Array<{ path: string; kind: string }>
    }
    expect(decisions).toMatchObject({
      agent: 'inferred',
      decisions: [expect.objectContaining({ path: 'sources/docs', kind: 'doc_bundle' })]
    })
    const packages = jsonl<{ kind: string; buildUnits: Array<{ standardKind: string; adapterId: string }> }>(
      await readFile(join(cwd, '.context', 'model', 'packages.jsonl'), 'utf8')
    )
    expect(packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'product_docs',
          buildUnits: [expect.objectContaining({ standardKind: 'semantic_corpus', adapterId: 'microsoft-graphrag.graph-adapter' })]
        })
      ])
    )
  })

  it('can compile an auto source by asking claude -p for grouping decisions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'context-source-grouping-claude-cli-'))
    await mkdir(join(cwd, 'sources', 'docs'), { recursive: true })
    await mkdir(join(cwd, 'bin'), { recursive: true })
    await writeFile(join(cwd, 'context.config.json'), JSON.stringify({ sources: [{ name: 'workspace', path: './sources' }] }, null, 2))
    await writeFile(join(cwd, 'sources', 'docs', 'product.md'), '# Product\n\n用户需要查看订单。\n')
    const fakeClaude = join(cwd, 'bin', 'claude')
    await writeFile(
      fakeClaude,
      `#!/usr/bin/env node
console.log(JSON.stringify({
  schemaVersion: 'context-source-grouping-decisions.v1',
  agent: 'claude',
  decisions: [
    {
      path: 'sources/docs',
      kind: 'doc_bundle',
      boundaryMode: 'collapsed',
      title: 'Product docs',
      summary: 'Product documentation grouped by Claude.',
      childrenPolicy: 'promote_routed',
      confidence: 0.92
    }
  ]
}))
`
    )
    await chmod(fakeClaude, 0o755)

    const previousPath = process.env.PATH
    const previousAgent = process.env.CONTEXT_SOURCE_GROUPING_AGENT
    const previousGraphRagRuntime = process.env.CONTEXT_GRAPHRAG_RUNTIME
    process.env.PATH = `${join(cwd, 'bin')}:${previousPath ?? ''}`
    process.env.CONTEXT_SOURCE_GROUPING_AGENT = 'claude'
    process.env.CONTEXT_GRAPHRAG_RUNTIME = 'mock'
    try {
      const compile = await runCli(['compile'], { cwd })
      expect(compile.exitCode).toBe(0)
      const decisions = JSON.parse(await readFile(join(cwd, '.context', 'state', 'grouping-decisions.json'), 'utf8')) as {
        agent?: string
        decisions: Array<{ path: string; kind: string }>
      }
      expect(decisions).toMatchObject({
        agent: 'claude',
        decisions: [expect.objectContaining({ path: 'sources/docs', kind: 'doc_bundle' })]
      })
      const groups = jsonl<{ path: string; title: string }>(await readFile(join(cwd, '.context', 'model', 'groups.jsonl'), 'utf8'))
      expect(groups).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'sources/docs', title: 'Product docs' })]))
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = previousPath
      }
      if (previousAgent === undefined) {
        delete process.env.CONTEXT_SOURCE_GROUPING_AGENT
      } else {
        process.env.CONTEXT_SOURCE_GROUPING_AGENT = previousAgent
      }
      if (previousGraphRagRuntime === undefined) {
        delete process.env.CONTEXT_GRAPHRAG_RUNTIME
      } else {
        process.env.CONTEXT_GRAPHRAG_RUNTIME = previousGraphRagRuntime
      }
    }
  })
})
