import type { ContextGraphAdapterRef } from '../contracts/graph.js'
import type { ContextPackageBuildUnit, ContextPackageKind, ContextPackageRecord, ContextSourceGroupRecord } from '../contracts/sources.js'
import { slug } from '../graph/model.js'

export interface BuildL0PackagesOptions {
  sourceName: string
  groups: ContextSourceGroupRecord[]
}

export function buildL0Packages(sourceName: string, groups: ContextSourceGroupRecord[]): ContextPackageRecord[] {
  const topLevelGroups = groups.filter((group) => !parentGroupFor(group, groups))
  return topLevelGroups.map((group) => {
    const kind = packageKindForSourceGroupKind(group.kind)
    const sourceGroupIds = groups.filter((candidate) => pathWithin(candidate.path, group.path)).map((candidate) => candidate.id).sort()
    const buildUnitKind = buildUnitKindForSourceGroupKind(group.kind)
    const standardKind = standardBuildUnitKindForSourceGroupKind(group.kind)
    const adapterSelection = adapterSelectionForSourceGroupKind(group.kind)
    return {
      id: packageIdForGroup(group),
      sourceName,
      path: group.path,
      title: `${packageKindLabel(kind)}: ${group.title}`,
      kind,
      summary: group.summary,
      sourceGroupIds,
      buildUnits: [
        {
          id: `unit:${slug(`${sourceName}:${group.path}:${buildUnitKind}`)}`,
          kind: buildUnitKind,
          standardKind,
          title: group.title,
          sourceGroupIds,
          adapterId: adapterSelection.adapterId,
          adapterSelection,
          path: group.path,
          summary: group.summary
        }
      ],
      confidence: group.confidence,
      decisionSource: group.decisionSource,
      sourceRef: group.sourceRef,
      metadata: {
        sourceGroupKind: group.kind,
        boundaryMode: group.boundaryMode,
        correctionDecisionIds: Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds : undefined
      }
    }
  })
}

export interface BuildPackageForGroupOptions {
  sourceName: string
  group: ContextSourceGroupRecord
}

function packageIdForGroup(group: ContextSourceGroupRecord): string {
  return `PACKAGE-${slug(`${group.sourceName}-${group.path}`)}`
}

export function packageKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageKind {
  switch (kind) {
    case 'repository':
      return 'code_repository'
    case 'test_bundle':
      return 'test_materials'
    case 'api_bundle':
      return 'api_contracts'
    case 'doc_bundle':
    case 'domain_area':
    case 'config_bundle':
      return 'product_docs'
    case 'analysis_bundle':
      return 'analysis'
    case 'design_bundle':
      return 'design'
    case 'data_bundle':
      return 'data'
    case 'runtime_bundle':
      return 'runtime'
    case 'asset_bundle':
      return 'asset'
    default:
      return 'unknown'
  }
}

export function packageKindLabel(kind: ContextPackageKind): string {
  switch (kind) {
    case 'product_docs':
      return '产品资料包'
    case 'code_repository':
      return '代码仓库包'
    case 'api_contracts':
      return 'API 合同包'
    case 'test_materials':
      return '测试资料包'
    case 'analysis':
      return '分析资料包'
    case 'design':
      return '设计资料包'
    case 'data':
      return '数据资料包'
    case 'runtime':
      return '运行时资料包'
    case 'asset':
      return '资产包'
    default:
      return '未知包'
  }
}

export function buildUnitKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageBuildUnit['kind'] {
  if (kind === 'repository') return 'repository'
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area' || kind === 'test_bundle') return 'graphrag_corpus'
  if (kind === 'api_bundle') return 'api_contracts'
  return 'inventory'
}

export function standardBuildUnitKindForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextPackageBuildUnit['standardKind'] {
  if (kind === 'repository') return 'repository'
  if (kind === 'doc_bundle' || kind === 'analysis_bundle' || kind === 'domain_area' || kind === 'test_bundle') return 'semantic_corpus'
  if (kind === 'api_bundle') return 'api_contracts'
  return 'inventory'
}

export function adapterSelectionForSourceGroupKind(kind: ContextSourceGroupRecord['kind']): ContextGraphAdapterRef {
  switch (kind) {
    case 'repository':
      return selectedAdapter('codegraph.graph-adapter', 'code-graph-builder', 'Default code graph adapter for repository source groups.', [
        'tree-sitter',
        'codegraph.graph-adapter'
      ])
    case 'doc_bundle':
    case 'analysis_bundle':
    case 'domain_area':
    case 'test_bundle':
      return selectedAdapter('microsoft-graphrag.graph-adapter', 'semantic-graph-builder', `Default semantic corpus adapter for ${kind} source groups.`, [
        'microsoft-graphrag.graph-adapter',
        'builtin.markdown-text'
      ])
    case 'api_bundle':
      return selectedAdapter('builtin.openapi', 'semantic-graph-builder', 'Default API contract adapter for api_bundle source groups.', ['builtin.openapi'])
    default:
      return selectedAdapter('builtin.source-inventory', 'inventory', `Default inventory-only adapter for ${kind} source groups.`, ['builtin.source-inventory'])
  }
}

function selectedAdapter(
  adapterId: string,
  role: ContextGraphAdapterRef['role'],
  selectionReason: string,
  candidateAdapterIds: string[]
): ContextGraphAdapterRef {
  return {
    adapterId,
    role,
    selectionSource: 'default',
    selectionReason,
    priority: 0,
    candidateAdapterIds
  }
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function parentGroupFor(group: ContextSourceGroupRecord, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups
    .filter((candidate) => candidate.id !== group.id && pathWithin(candidate.path, group.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}
