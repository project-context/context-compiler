import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { searchContextIndex } from '@context-compiler/core/runtime'
import { createContextNode, type ContextGraph } from '@context-compiler/core/sdk'

const execFileAsync = promisify(execFile)

const graph: ContextGraph = {
  nodes: [
    createContextNode({
      id: 'REQ-ORDER-REFUND-001',
      type: 'Requirement',
      name: 'Support partial refund',
      content: 'A paid order can receive a partial refund.',
      sourceRefs: [{ sourceId: 'docs', uri: 'file://docs/refund.md', location: { path: 'docs/refund.md' } }],
      properties: { marker: 'sqlite-hit' }
    }),
    createContextNode({
      id: 'REQ-ORDER-CANCEL-001',
      type: 'Requirement',
      name: 'Cancel order',
      content: 'Users can cancel unpaid orders.',
      sourceRefs: [{ sourceId: 'docs', uri: 'file://docs/cancel.md', location: { path: 'docs/cancel.md' } }],
      properties: { marker: 'memory-only' }
    })
  ],
  edges: [],
  diagnostics: []
}

describe('SQLite-backed context search', () => {
  it('hydrates canonical graph nodes from real SQLite FTS ids', async () => {
    const outputDir = await contextDir()
    await writeFtsIndex(join(outputDir, 'index', 'global', 'fts.sqlite'), [
      { id: 'REQ-ORDER-REFUND-001', text: 'refund sqlite only term' }
    ])

    const result = await searchContextIndex({ outputDir, graph, query: 'sqlite', limit: 5 })

    expect(result).toMatchObject({
      engine: 'sqlite',
      indexPath: '.context/index/global/fts.sqlite',
      results: [expect.objectContaining({ id: 'REQ-ORDER-REFUND-001', properties: expect.objectContaining({ marker: 'sqlite-hit' }) })],
      diagnostics: []
    })
  })

  it('falls back to memory search when SQLite index is missing', async () => {
    const outputDir = await contextDir()

    const result = await searchContextIndex({ outputDir, graph, query: 'cancel', limit: 5 })

    expect(result.engine).toBe('memory-fallback')
    expect(result.results.map((node) => node.id)).toEqual(['REQ-ORDER-CANCEL-001'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.type)).toContain('search.index.missing')
  })

  it('falls back to memory search when SQLite returns no rows', async () => {
    const outputDir = await contextDir()
    await writeFtsIndex(join(outputDir, 'index', 'global', 'fts.sqlite'), [
      { id: 'REQ-ORDER-REFUND-001', text: 'unrelated sqlite row' }
    ])

    const result = await searchContextIndex({ outputDir, graph, query: 'cancel', limit: 5 })

    expect(result.engine).toBe('sqlite-empty-fallback')
    expect(result.results.map((node) => node.id)).toEqual(['REQ-ORDER-CANCEL-001'])
    expect(result.diagnostics.map((diagnostic) => diagnostic.type)).toContain('search.index.empty')
  })

  it('tokenizes hostile query strings before passing them to SQLite', async () => {
    const outputDir = await contextDir()
    await writeFtsIndex(join(outputDir, 'index', 'global', 'fts.sqlite'), [
      { id: 'REQ-ORDER-REFUND-001', text: 'refund sqlite only term' }
    ])

    const result = await searchContextIndex({ outputDir, graph, query: `refund' OR 1=1 --`, limit: 5 })

    expect(result.engine).toBe('sqlite')
    expect(result.results.map((node) => node.id)).toEqual(['REQ-ORDER-REFUND-001'])
  })
})

async function contextDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'context-search-index-'))
}

async function writeFtsIndex(path: string, rows: Array<{ id: string; text: string }>): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await rm(path, { force: true })
  const inserts = rows.map((row) => `INSERT INTO fts_text (id, text) VALUES (${sql(row.id)}, ${sql(row.text)});`).join('\n')
  await execFileAsync('sqlite3', [
    path,
    [
      'CREATE TABLE fts (id TEXT PRIMARY KEY, data TEXT NOT NULL);',
      'CREATE VIRTUAL TABLE fts_text USING fts5(id, text);',
      inserts
    ].join('\n')
  ])
}

function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
