import { describe, expect, it } from 'vitest'
import { createProgressFormatter } from './progress.js'
import { type ContextProgressEvent } from '@context-compiler/core/sdk'

function event(type: string, extra: Partial<ContextProgressEvent> = {}): ContextProgressEvent {
  return {
    schemaVersion: 'context-progress-event.v1',
    timestamp: '2026-06-05T00:00:00.000Z',
    type,
    message: type,
    ...extra
  }
}

describe('CLI progress formatter', () => {
  it('renders weighted compile percentages in log mode', () => {
    const formatter = createProgressFormatter({ style: 'log' })

    expect(formatter.format(event('compile.started'))).toBe('[  0%] [compile] started\n')
    expect(formatter.format(event('stage.started', { stage: 'ingest', metadata: { components: ['ingest.local-files', 'ingest.other'] } }))).toBe(
      '[  5%] [compile] stage ingest started\n'
    )
    expect(formatter.format(event('component.completed', { stage: 'ingest', componentId: 'ingest.local-files', metadata: { facts: 1, edges: 2, diagnostics: 0 } }))).toBe(
      '[ 15%] [compile] component ingest.local-files completed (1 facts, 2 edges, 0 diagnostics)\n'
    )
    expect(formatter.format(event('component.completed', { stage: 'ingest', componentId: 'ingest.other', metadata: { facts: 2, edges: 3, diagnostics: 0 } }))).toBe(
      '[ 25%] [compile] component ingest.other completed (2 facts, 3 edges, 0 diagnostics)\n'
    )
  })

  it('keeps indeterminate adapter installs anchored to the current weighted phase', () => {
    const formatter = createProgressFormatter({ style: 'log' })
    formatter.format(event('stage.started', { stage: 'enrich', metadata: { components: ['enrich.inventory', 'enrich.scope-adapters'] } }))
    formatter.format(event('component.started', { stage: 'enrich', componentId: 'enrich.scope-adapters' }))

    expect(formatter.format(event('adapter.install.started', { adapterId: 'microsoft-graphrag.graph-adapter' }))).toBe(
      '[ 65%] [adapter] microsoft-graphrag.graph-adapter install started ...\n'
    )
  })

  it('renders a single-line progress bar in TTY mode and finishes with a newline', () => {
    const formatter = createProgressFormatter({ style: 'bar', width: 10 })

    expect(formatter.format(event('compile.started'))).toContain('\r[----------]   0% Compile started')
    expect(formatter.format(event('stage.completed', { stage: 'emit', metadata: { nodes: 9, edges: 12, diagnostics: 0 } }))).toContain(
      '\r[##########] 100% emit'
    )
    expect(formatter.format(event('compile.completed', { metadata: { nodes: 9, edges: 12, diagnostics: 0 } }))).toMatch(/\n$/)
  })
})
