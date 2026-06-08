import { access, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { ContextGraph, ContextGraphScopeManifest, ContextNode, Diagnostic } from '../contracts/index.js'
import { createDiagnostic } from '../diagnostics/index.js'
import { queryGraph } from '../graph/index.js'

const execFileAsync = promisify(execFile)

export type ContextSearchEngine = 'sqlite' | 'sqlite-empty-fallback' | 'memory-fallback'

export interface SearchContextIndexInput {
  outputDir: string
  graph: ContextGraph
  query: string
  limit?: number
  scopeId?: string
}

export interface SearchContextIndexResult {
  engine: ContextSearchEngine
  indexPath: string
  scopeId?: string
  results: ContextNode[]
  diagnostics: Diagnostic[]
}

/** Query materialized SQLite FTS indexes first, then hydrate canonical graph nodes. */
export async function searchContextIndex(input: SearchContextIndexInput): Promise<SearchContextIndexResult> {
  const limit = input.limit ?? 20
  const scoped = input.scopeId ? await resolveScopedSearch(input.outputDir, input.scopeId) : undefined
  const graph = scoped?.graph ?? input.graph
  const indexPath = scoped?.indexPath ?? '.context/indexes/global/fts.sqlite'
  const sqlitePath = resolveContextPath(input.outputDir, indexPath)
  const missingDiagnostic = await missingIndexDiagnostic(sqlitePath, indexPath)
  if (missingDiagnostic) {
    return memoryFallback({ ...input, graph, indexPath, reason: missingDiagnostic })
  }

  const query = sqliteFtsQuery(input.query)
  if (!query) {
    return memoryFallback({
      ...input,
      graph,
      indexPath,
      reason: searchDiagnostic('search.index.empty-query', indexPath, 'Search query did not contain indexable tokens.')
    })
  }

  const sqlite = await querySqliteFts(sqlitePath, query, limit)
  if (!sqlite.ok) {
    return memoryFallback({
      ...input,
      graph,
      indexPath,
      reason: searchDiagnostic('search.index.query-failed', indexPath, sqlite.error)
    })
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const results = sqlite.ids.map((id) => byId.get(id)).filter((node): node is ContextNode => Boolean(node))
  if (results.length > 0) {
    return {
      engine: 'sqlite',
      indexPath,
      scopeId: input.scopeId,
      results,
      diagnostics: []
    }
  }

  const fallbackResults = queryGraph(graph, input.query, limit)
  return {
    engine: 'sqlite-empty-fallback',
    indexPath,
    scopeId: input.scopeId,
    results: fallbackResults,
    diagnostics: [searchDiagnostic('search.index.empty', indexPath, `SQLite FTS index returned no hydrated nodes for query: ${input.query}`)]
  }
}

async function resolveScopedSearch(outputDir: string, scopeId: string): Promise<{ indexPath: string; graph: ContextGraph } | undefined> {
  const manifest = await readScopeManifest(outputDir)
  const scope = manifest?.scopes.find((candidate) => candidate.id === scopeId)
  if (!scope) {
    return undefined
  }
  const [nodes, edges] = await Promise.all([
    readJsonl<ContextGraph['nodes'][number]>(resolveContextPath(outputDir, scope.nodes)),
    readJsonl<ContextGraph['edges'][number]>(resolveContextPath(outputDir, scope.edges))
  ])
  return {
    indexPath: scope.indexRefs.fts,
    graph: { nodes, edges, diagnostics: [] }
  }
}

async function readScopeManifest(outputDir: string): Promise<ContextGraphScopeManifest | undefined> {
  try {
    return JSON.parse(await readFile(resolve(outputDir, 'graph', 'scopes', 'manifest.json'), 'utf8')) as ContextGraphScopeManifest
  } catch {
    return undefined
  }
}

async function querySqliteFts(path: string, query: string, limit: number): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const sql = `SELECT id FROM fts_text WHERE fts_text MATCH ${sqliteString(query)} ORDER BY bm25(fts_text), id LIMIT ${Math.max(1, Math.floor(limit))};`
  try {
    const result = await execFileAsync('sqlite3', ['-json', path, sql], { maxBuffer: 1024 * 1024 })
    const rows = parseMaybeJsonRows(result.stdout.trim())
    return { ok: true, ids: rows.map((row) => row.id).filter((id): id is string => typeof id === 'string') }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function parseMaybeJsonRows(output: string): Array<{ id?: unknown }> {
  if (!output) {
    return []
  }
  const parsed = JSON.parse(output) as unknown
  return Array.isArray(parsed) ? parsed.filter((row): row is { id?: unknown } => typeof row === 'object' && row !== null) : []
}

async function missingIndexDiagnostic(sqlitePath: string, indexPath: string): Promise<Diagnostic | undefined> {
  try {
    await access(sqlitePath)
    return undefined
  } catch {
    return searchDiagnostic('search.index.missing', indexPath, `SQLite FTS index is missing: ${indexPath}`)
  }
}

function memoryFallback(input: SearchContextIndexInput & { graph: ContextGraph; indexPath: string; reason: Diagnostic }): SearchContextIndexResult {
  return {
    engine: 'memory-fallback',
    indexPath: input.indexPath,
    scopeId: input.scopeId,
    results: queryGraph(input.graph, input.query, input.limit ?? 20),
    diagnostics: [input.reason]
  }
}

function sqliteFtsQuery(query: string): string | undefined {
  const tokens = query.toLowerCase().match(/[a-z0-9_\-\u4e00-\u9fff]+/g) ?? []
  const safeTokens = tokens
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length > 0 && token !== 'or' && token !== 'and' && token !== 'not')
    .slice(0, 16)
  return safeTokens.length > 0 ? safeTokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' OR ') : undefined
}

function searchDiagnostic(code: string, indexPath: string, message: string): Diagnostic {
  return createDiagnostic({
    severity: 'warning',
    code,
    message,
    metadata: { indexPath }
  })
}

function resolveContextPath(outputDir: string, path: string): string {
  if (path.startsWith('.context/')) {
    return resolve(outputDir, path.slice('.context/'.length))
  }
  return resolve(outputDir, path)
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, 'utf8')
  return content.trim().length === 0 ? [] : content.trim().split('\n').map((line) => JSON.parse(line) as T)
}

function sqliteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
