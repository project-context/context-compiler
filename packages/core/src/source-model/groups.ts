import { basename, resolve } from 'node:path'
import type { SourceConfig, SourceRef } from '../contracts/config.js'
import type { ContextSourceGroupingDecision, ContextSourceGroupingRequest, ContextSourceGroupRecord } from '../contracts/sources.js'
import { slug } from '../graph/model.js'

export interface GroupingDecisionToSourceGroupRecordOptions {
  source: SourceConfig
  rootDir: string
  decision: ContextSourceGroupingDecision
  decisionSource: ContextSourceGroupRecord['decisionSource']
}

export interface GroupingRequestSeedOptions {
  source: SourceConfig
  sourceRootPath: string
  entries: { source: string; route?: string; path: string }[]
}

/** Convert grouping decisions into canonical source-group records. */
export function groupingDecisionToSourceGroupRecord(options: GroupingDecisionToSourceGroupRecordOptions): ContextSourceGroupRecord {
  const path = decisionPath(options.decision)
  return {
    id: `SOURCE-GROUP-${slug(`${options.source.name}-${path}`)}`,
    sourceName: options.source.name,
    path,
    title: options.decision.title,
    kind: correctedSourceGroupKind(options.decision.kind, 'unknown'),
    boundaryMode: correctedBoundaryMode(options.decision.boundaryMode, 'collapsed'),
    summary: options.decision.summary,
    childrenPolicy: options.decision.childrenPolicy,
    confidence: options.decision.confidence,
    decisionSource: options.decisionSource,
    sourceRef: sourceRefFor(options.source.name, options.rootDir, resolve(options.rootDir, path), path)
  }
}

/** Build a fallback grouping decision for material that cannot be classified. */
export function buildInferredUnknownGroupingDecision(sourceRootPath: string): ContextSourceGroupingDecision {
  return {
    path: sourceRootPath,
    kind: 'unknown',
    boundaryMode: 'collapsed',
    title: '未知资料包',
    summary: 'Source materials could not be confidently classified, so they are preserved as an inventory-only unknown package.',
    childrenPolicy: 'promote_routed',
    confidence: 0.35
  }
}

/** Build a deterministic grouping decision from an explicit source type hint. */
export function buildTypedSourceGroupingDecision(
  source: SourceConfig,
  sourceRootPath: string,
  entries: Array<{ route?: string; mediaType?: string; path: string }>
): ContextSourceGroupingDecision {
  const kind = typedSourceGroupKind(source, entries)
  return {
    path: sourceRootPath,
    kind,
    boundaryMode: kind === 'repository' ? 'repository' : 'collapsed',
    title: titleForTypedSource(source, sourceRootPath),
    summary: summaryForTypedSource(source, kind, entries.length),
    childrenPolicy: kind === 'doc_bundle' || kind === 'api_bundle' || kind === 'repository' || kind === 'test_bundle' ? 'promote_routed' : 'promote_none',
    confidence: source.type || source.parser || source.mediaType ? 0.85 : 0.55
  }
}

export function decisionPath(decision: Pick<ContextSourceGroupingDecision, 'path'>): string {
  return normalizeConfiguredPath(decision.path)
}

export function pathWithin(path: string, rootPath: string): boolean {
  const normalizedPath = normalizeConfiguredPath(path)
  const normalizedRoot = normalizeConfiguredPath(rootPath)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export function sourceRefFor(sourceName: string, rootDir: string, file: string, path: string): SourceRef {
  const sourceRefPath = normalizePath(relativePathFromRoot(file, rootDir))
  return {
    sourceId: `${sourceName}:${slug(sourceRefPath)}`,
    uri: `file://${sourceRefPath}`,
    title: sourceName,
    location: {
      path: normalizePath(path)
    }
  }
}

function relativePathFromRoot(file: string, rootDir: string): string {
  const normalizedRoot = normalizePath(rootDir)
  const normalizedFile = normalizePath(file)
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1)
  }
  return normalizedFile
}

function correctedSourceGroupKind(value: string | undefined, fallback: ContextSourceGroupingDecision['kind']): ContextSourceGroupingDecision['kind'] {
  return value && allowedSourceGroupKinds.has(value as ContextSourceGroupingDecision['kind']) ? (value as ContextSourceGroupingDecision['kind']) : fallback
}

function correctedBoundaryMode(value: string | undefined, fallback: ContextSourceGroupingDecision['boundaryMode']): ContextSourceGroupingDecision['boundaryMode'] {
  return value === 'expanded' || value === 'collapsed' || value === 'repository' ? value : fallback
}

const allowedSourceGroupKinds = new Set<ContextSourceGroupingDecision['kind']>([
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

function typedSourceGroupKind(source: SourceConfig, entries: Array<{ route?: string; mediaType?: string }>): ContextSourceGroupingDecision['kind'] {
  const markerKind = typedSourceGroupKindFromNameAndPath(source)
  if (markerKind) {
    return markerKind
  }
  const hint = normalizeSourceHint(source.parser ?? source.type ?? source.mediaType)
  switch (hint) {
    case 'code':
    case 'git':
    case 'repository':
    case 'repo':
      return 'repository'
    case 'markdown':
    case 'md':
    case 'doc':
    case 'docs':
    case 'document':
    case 'documents':
      return 'doc_bundle'
    case 'openapi':
    case 'swagger':
    case 'api':
      return 'api_bundle'
    case 'test':
    case 'tests':
    case 'testing':
      return 'test_bundle'
    case 'design':
    case 'figma':
      return 'design_bundle'
    case 'data':
      return 'data_bundle'
    case 'runtime':
    case 'logs':
    case 'metrics':
      return 'runtime_bundle'
    case 'asset':
    case 'assets':
    case 'image':
    case 'images':
      return 'asset_bundle'
    case 'analysis':
    case 'report':
    case 'reports':
      return 'analysis_bundle'
    default:
      return sourceGroupKindFromEntryRoutes(entries)
  }
}

function typedSourceGroupKindFromNameAndPath(source: SourceConfig): ContextSourceGroupingDecision['kind'] | undefined {
  const text = normalizeSourceHint(`${source.name} ${source.path}`)
  if (/(^|[^a-z])(openapi|swagger|api|apis|contract|contracts)([^a-z]|$)/.test(text)) return 'api_bundle'
  if (/(^|[^a-z])(test|tests|testing|qa|spec|specs|case|cases)([^a-z]|$)/.test(text)) return 'test_bundle'
  if (/(^|[^a-z])(design|figma|wireframe|mockup)([^a-z]|$)/.test(text)) return 'design_bundle'
  if (/(^|[^a-z])(asset|assets|image|images|media|static)([^a-z]|$)/.test(text)) return 'asset_bundle'
  if (/(^|[^a-z])(analysis|analytics|report|reports|research)([^a-z]|$)/.test(text)) return 'analysis_bundle'
  if (/(^|[^a-z])(data|dataset|datasets|fixture|fixtures)([^a-z]|$)/.test(text)) return 'data_bundle'
  if (/(^|[^a-z])(runtime|metrics|logs|monitoring|telemetry)([^a-z]|$)/.test(text)) return 'runtime_bundle'
  return undefined
}

function sourceGroupKindFromEntryRoutes(entries: Array<{ route?: string; mediaType?: string }>): ContextSourceGroupingDecision['kind'] {
  const routes = new Set(entries.map((entry) => entry.route).filter(Boolean))
  if (routes.has('code')) return 'repository'
  if (routes.has('openapi')) return 'api_bundle'
  if (routes.has('markdown')) return 'doc_bundle'
  if (entries.some((entry) => entry.mediaType?.startsWith('image/'))) return 'asset_bundle'
  return 'unknown'
}

function titleForTypedSource(source: SourceConfig, sourceRootPath: string): string {
  return headline(source.name || basename(sourceRootPath) || sourceRootPath)
}

function summaryForTypedSource(source: SourceConfig, kind: ContextSourceGroupingDecision['kind'], fileCount: number): string {
  const label = kind.replace(/_/g, ' ')
  const hint = source.parser ?? source.type ?? source.mediaType ?? 'typed'
  return `${headline(source.name)} is a ${label} source group inferred from explicit ${hint} source configuration with ${fileCount} file${fileCount === 1 ? '' : 's'}.`
}

function normalizeSourceHint(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/^application\//, '').replace(/^text\//, '').replace(/[_/.-]+/g, ' ') : ''
}

function headline(value: string): string {
  return value
    .split(/[-_\s/]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || value
}

function normalizePath(value: string): string {
  return value.split('\\').join('/')
}

function normalizeConfiguredPath(value: string): string {
  return normalizePath(value).replace(/^\.\/+/, '').replace(/\/+$/, '')
}

export interface GroupingRequestSeed {
  schemaVersion: 'context-source-grouping-request.v1'
  generatedAt: string
  sources: Array<{
    sourceName: string
    root: string
    candidates: ContextSourceGroupCandidate[]
  }>
}

interface ContextSourceGroupCandidate {
  path: string
  title: string
  fileCount: number
  directoryCount: number
  extensionCounts: Record<string, number>
  markers: string[]
  representativeFiles: string[]
  suggestedKind: ContextSourceGroupingDecision['kind']
  suggestedBoundaryMode: ContextSourceGroupingDecision['boundaryMode']
  confidence: number
}

export function buildGroupingRequest(source: SourceConfig, sourceRootPath: string, entries: { path: string }[]): GroupingRequestSeed {
  const candidates: ContextSourceGroupCandidate[] = [
    {
      path: sourceRootPath,
      title: basename(sourceRootPath),
      fileCount: entries.length,
      directoryCount: 1,
      extensionCounts: {},
      markers: [],
      representativeFiles: entries.slice(0, 4).map((entry) => entry.path),
      suggestedKind: 'unknown',
      suggestedBoundaryMode: 'collapsed',
      confidence: 0.55
    }
  ]
  return {
    schemaVersion: 'context-source-grouping-request.v1',
    generatedAt: new Date().toISOString(),
    sources: [
      {
        sourceName: source.name,
        root: source.path,
        candidates
      }
    ]
  }
}
