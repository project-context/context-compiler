import { createContextEdge, createContextNode, slug } from '../graph/model.js'
import { scopeDirName, scopeIdForPackage, scopeIdForSourceGroup } from '../graph/scopes.js'
import { sourceRefFor } from './groups.js'
import type { SourceConfig } from '../contracts/config.js'
import type { ContextEdge, ContextGraph, ContextNode } from '../contracts/graph.js'
import type { ContextPackageRecord, ContextSourceGroupRecord } from '../contracts/sources.js'

export interface SourceRootNodeOptions {
  source: SourceConfig
  rootDir: string
  sourcePath: string
  configuredPath: string
}

export interface BuildSourceModelSeedGraphOptions {
  sourceNode: ContextNode
  packages: ContextPackageRecord[]
  groups: ContextSourceGroupRecord[]
}

/** Create canonical source root node. */
export function sourceRootNode(options: SourceRootNodeOptions): ContextNode {
  const rootSourceRef = sourceRefFor(options.source.name, options.rootDir, options.sourcePath, options.configuredPath)
  return createContextNode({
    id: `SOURCE-${slug(options.source.name)}`,
    type: 'Source',
    name: options.source.name,
    sourceRefs: [rootSourceRef],
    properties: {
      path: options.source.path,
      type: options.source.type ?? 'auto',
      parser: options.source.parser,
      mediaType: options.source.mediaType
    }
  })
}

/** Materialize source root, package and group nodes plus structural source edges. */
export function buildSourceModelSeedGraph(options: BuildSourceModelSeedGraphOptions): ContextGraph {
  const nodes = [
    options.sourceNode,
    ...options.packages.map((record) => l0PackageNode(record)),
    ...options.groups.map((group) => sourceGroupNode(group))
  ].sort(byId)
  const edges: ContextEdge[] = []

  for (const record of options.packages) {
    const packageScopeId = scopeIdForPackage(record.id)
    edges.push(
      createContextEdge({
        id: `EDGE-${options.sourceNode.id}-contains-package-${record.id}`,
        from: options.sourceNode.id,
        to: record.id,
        type: 'contains_package',
        linker: 'source-model',
        status: 'confirmed',
        evidence: []
      })
    )
    edges.push(
      createContextEdge({
        id: `EDGE-${record.id}-materializes-subgraph-${slug(packageScopeId)}`,
        from: record.id,
        to: record.id,
        type: 'materializes_subgraph',
        linker: 'source-model',
        status: 'confirmed',
        evidence: [],
        properties: {
          scopeId: packageScopeId,
          subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`
        }
      })
    )
    for (const groupId of record.sourceGroupIds) {
      edges.push(
        createContextEdge({
          id: `EDGE-${record.id}-contains-source-group-${groupId}`,
          from: record.id,
          to: groupId,
          type: 'contains_source_group',
          linker: 'source-model',
          status: 'confirmed',
          evidence: []
        })
      )
    }
  }

  for (const group of options.groups) {
    const scopeId = scopeIdForSourceGroup(group.id)
    edges.push(
      createContextEdge({
        id: `EDGE-${group.id}-materializes-subgraph-${slug(scopeId)}`,
        from: group.id,
        to: group.id,
        type: 'materializes_subgraph',
        linker: 'source-model',
        status: 'confirmed',
        evidence: [],
        properties: {
          scopeId,
          subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`
        }
      })
    )
  }

  for (const group of options.groups) {
    const parent = parentGroupFor(group, options.groups)
    if (!parent) {
      continue
    }
    edges.push(
      createContextEdge({
        id: `EDGE-${parent.id}-has-child-scope-${group.id}`,
        from: parent.id,
        to: group.id,
        type: 'has_child_scope',
        linker: 'source-model',
        status: 'confirmed',
        evidence: [],
        properties: {
          parentScopeId: scopeIdForSourceGroup(parent.id),
          childScopeId: scopeIdForSourceGroup(group.id)
        }
      })
    )
  }

  return {
    nodes,
    edges: edges.sort(byId),
    diagnostics: []
  }
}

function l0PackageNode(record: ContextPackageRecord): ContextNode {
  const packageScopeId = scopeIdForPackage(record.id)
  return createContextNode({
    id: record.id,
    type: 'Package',
    name: record.title,
    status: 'hypothesis',
    scopeId: 'scope:project',
    subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`,
    sourceRefs: [record.sourceRef],
    confidence: record.confidence,
    properties: {
      packageKind: record.kind,
      path: record.path,
      summary: record.summary,
      sourceGroupIds: record.sourceGroupIds,
      buildUnits: record.buildUnits,
      confidence: record.confidence,
      decisionSource: record.decisionSource,
      sourceName: record.sourceName,
      scopeId: packageScopeId,
      subgraphRef: `.context/graph/scopes/${scopeDirName(packageScopeId)}`
    }
  })
}

function sourceGroupNode(group: ContextSourceGroupRecord): ContextNode {
  const scopeId = scopeIdForSourceGroup(group.id)
  return createContextNode({
    id: group.id,
    type: 'SourceGroup',
    name: group.title,
    status: 'hypothesis',
    scopeId: 'scope:project',
    subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`,
    sourceRefs: [group.sourceRef],
    confidence: group.confidence,
    properties: {
      kind: group.kind,
      path: group.path,
      boundaryMode: group.boundaryMode,
      summary: group.summary,
      childrenPolicy: group.childrenPolicy,
      confidence: group.confidence,
      decisionSource: group.decisionSource,
      sourceName: group.sourceName,
      scopeId,
      subgraphRef: `.context/graph/scopes/${scopeDirName(scopeId)}`
    }
  })
}

function parentGroupFor(group: ContextSourceGroupRecord, groups: ContextSourceGroupRecord[]): ContextSourceGroupRecord | undefined {
  return groups
    .filter((candidate) => candidate.id !== group.id && pathWithin(candidate.path, group.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
}

function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path).replace(/^\.\/+/, '').replace(/\/+$/, '')
  const normalizedRoot = normalizePath(rootPath).replace(/^\.\/+/, '').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id)
}
