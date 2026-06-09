import { pathWithin, sourceRefFor } from './groups.js'
import { basename, resolve } from 'node:path'
import type { SourceConfig } from '../contracts/config.js'
import type { ContextSourceCorrectionDecision } from '../contracts/corrections.js'
import type { ContextPackageBuildUnit, ContextPackageRecord, ContextSourceGroupRecord } from '../contracts/sources.js'

export interface ApplySourceCorrectionDecisionsOptions {
  groups: ContextSourceGroupRecord[]
  decisions: ContextSourceCorrectionDecision[]
  sourceRootPath: string
  source: SourceConfig
  rootDir: string
}

/** Apply active source correction decisions before package materialization. */
export function applySourceCorrectionDecisions(options: ApplySourceCorrectionDecisionsOptions): ContextSourceGroupRecord[] {
  if (options.decisions.length === 0) {
    return options.groups
  }
  const applicable = effectiveSourceCorrectionDecisionRows(options.decisions)
    .filter((decision) => decision.status === 'applied')
    .filter((decision) => sourceCorrectionWithinRoot(decision, options.sourceRootPath))
  if (applicable.length === 0) {
    return options.groups
  }

  const byId = new Map(options.groups.map((group) => [group.id, group]))
  const next = options.groups.map((group) => {
    let current = group
    const groupDecisions = applicable.filter((decision) => correctionAppliesToGroup(decision, current))
    for (const decision of groupDecisions) {
      current = applySourceCorrectionDecisionToGroup(current, decision)
    }
    byId.set(current.id, current)
    return current
  })

  for (const decision of applicable.filter((candidate) => candidate.kind === 'split')) {
    const targetId = decision.sourceGroupId
    const after = decision.after
    const path = stringRecordValue(after, 'path') ?? decision.sourcePath
    if (!targetId || !path || byId.has(targetId)) {
      continue
    }
    const kind = correctedSourceGroupKind(stringRecordValue(after, 'kind'), 'unknown')
    const group: ContextSourceGroupRecord = {
      id: targetId,
      sourceName: options.source.name,
      path,
      title: stringRecordValue(after, 'title') ?? basename(path),
      kind,
      boundaryMode: correctedBoundaryMode(stringRecordValue(after, 'boundaryMode'), kind === 'repository' ? 'repository' : 'collapsed'),
      summary: stringRecordValue(after, 'summary') ?? `Source group created by correction ${decision.id}.`,
      confidence: numberRecordValue(after, 'confidence') ?? 0.7,
      decisionSource: 'agent',
      sourceRef: sourceRefFor(options.source.name, options.rootDir, resolve(options.rootDir, path), path),
      metadata: { correctionDecisionIds: [decision.id] }
    }
    byId.set(group.id, group)
    next.push(group)
  }
  return next.sort((left, right) => left.path.localeCompare(right.path))
}

/** Collapse duplicate/cancelled rows into latest effective decisions. */
export function effectiveSourceCorrectionDecisionRows(decisions: ContextSourceCorrectionDecision[]): ContextSourceCorrectionDecision[] {
  const latestById = latestDecisionById(decisions)
  const groups = new Map<string, ContextSourceCorrectionDecision[]>()
  for (const decision of latestById) {
    const key = decision.dedupeKey ?? decisionDedupeKey(decision)
    groups.set(key, [...(groups.get(key) ?? []), { ...decision, dedupeKey: key }])
  }
  const result: ContextSourceCorrectionDecision[] = []
  for (const group of groups.values()) {
    const ordered = group.sort((left, right) => decisionTime(left).localeCompare(decisionTime(right)) || left.id.localeCompare(right.id))
    const latestApplied = [...ordered].reverse().find((decision) => decision.status === 'applied')
    for (const decision of ordered) {
      if (latestApplied && decision.id !== latestApplied.id && decision.status === 'applied') {
        result.push({
          ...decision,
          status: 'superseded',
          supersededByDecisionId: latestApplied.id
        })
      } else if (latestApplied && decision.id === latestApplied.id) {
        result.push({
          ...decision,
          supersedesDecisionIds: ordered.filter((candidate) => candidate.id !== decision.id && candidate.status === 'applied').map((candidate) => candidate.id)
        })
      } else {
        result.push(decision)
      }
    }
  }
  return result.sort((left, right) => decisionTime(left).localeCompare(decisionTime(right)) || left.id.localeCompare(right.id))
}

export interface SourceCorrectionDecisionDecisionRowsOptions {
  sourceGroupIds?: Set<string>
}

function applySourceCorrectionDecisionToGroup(
  group: ContextSourceGroupRecord,
  decision: ContextSourceCorrectionDecision
): ContextSourceGroupRecord {
  const decisionIds = [...new Set([...(Array.isArray(group.metadata?.correctionDecisionIds) ? group.metadata.correctionDecisionIds.filter((id): id is string => typeof id === 'string') : []), decision.id])]
  const metadata = { ...(group.metadata ?? {}), correctionDecisionIds: decisionIds }
  if (decision.kind === 'relabel') {
    return {
      ...group,
      title: stringRecordValue(decision.after, 'title') ?? group.title,
      kind: correctedSourceGroupKind(stringRecordValue(decision.after, 'kind'), group.kind),
      boundaryMode: correctedBoundaryMode(stringRecordValue(decision.after, 'boundaryMode'), group.boundaryMode),
      summary: stringRecordValue(decision.after, 'summary') ?? group.summary,
      confidence: numberRecordValue(decision.after, 'confidence') ?? group.confidence,
      metadata
    }
  }
  if (decision.kind === 'merge') {
    return {
      ...group,
      metadata: {
        ...metadata,
        mergedIntoGroupId: decision.targetGroupId,
        mergedIntoPath: decision.targetPath
      }
    }
  }
  if (decision.kind === 'rehome') {
    return {
      ...group,
      metadata: {
        ...metadata,
        rehomeTargetGroupId: decision.targetGroupId,
        rehomeTargetPath: decision.targetPath
      }
    }
  }
  return { ...group, metadata }
}

function correctedSourceGroupKind(value: string | undefined, fallback: ContextSourceGroupRecord['kind']): ContextSourceGroupRecord['kind'] {
  const allowed = new Set<ContextSourceGroupRecord['kind']>([
    'repository',
    'doc_bundle',
    'asset_bundle',
    'analysis_bundle',
    'domain_area',
    'data_bundle',
    'api_bundle',
    'design_bundle',
    'test_bundle',
    'config_bundle',
    'runtime_bundle',
    'vendor_bundle',
    'generated_bundle',
    'archive',
    'unknown'
  ])
  return value && allowed.has(value as ContextSourceGroupRecord['kind']) ? value as ContextSourceGroupRecord['kind'] : fallback
}

function correctedBoundaryMode(value: string | undefined, fallback: ContextSourceGroupRecord['boundaryMode']): ContextSourceGroupRecord['boundaryMode'] {
  return value === 'expanded' || value === 'collapsed' || value === 'repository' ? value : fallback
}

function sourceCorrectionWithinRoot(decision: ContextSourceCorrectionDecision, sourceRootPath: string): boolean {
  return [decision.sourcePath, decision.targetPath]
    .filter((path): path is string => typeof path === 'string')
    .some((path) => pathWithin(path, sourceRootPath) || pathWithin(sourceRootPath, path))
}

function correctionAppliesToGroup(decision: ContextSourceCorrectionDecision, group: ContextSourceGroupRecord): boolean {
  return (
    decision.sourceGroupId === group.id ||
    decision.targetGroupId === group.id ||
    Boolean(decision.sourcePath && pathWithin(decision.sourcePath, group.path)) ||
    Boolean(decision.targetPath && pathWithin(decision.targetPath, group.path))
  )
}

function stringRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function numberRecordValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function latestDecisionById(decisions: ContextSourceCorrectionDecision[]): ContextSourceCorrectionDecision[] {
  const byId = new Map<string, ContextSourceCorrectionDecision>()
  for (const decision of decisions) {
    const existing = byId.get(decision.id)
    if (!existing || decisionTime(existing) <= decisionTime(decision)) {
      byId.set(decision.id, decision)
    }
  }
  return [...byId.values()]
}

function decisionDedupeKey(decision: ContextSourceCorrectionDecision): string {
  return [
    decision.kind,
    decision.packageId,
    decision.sourceGroupId,
    decision.targetGroupId,
    decision.sourcePath,
    decision.targetPath
  ].filter(Boolean).join(':')
}

function decisionTime(decision: ContextSourceCorrectionDecision): string {
  return decision.updatedAt ?? decision.createdAt
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}
