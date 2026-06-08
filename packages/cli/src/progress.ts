import type { ContextProgressEvent, PipelineStage } from '@context-compiler/core'

export type CliProgressStyle = 'log' | 'bar'

export interface ProgressFormatterOptions {
  style: CliProgressStyle
  width?: number
}

interface StageRange {
  start: number
  end: number
}

const STAGE_RANGES: Partial<Record<PipelineStage, StageRange>> = {
  ingest: { start: 5, end: 25 },
  parse: { start: 25, end: 45 },
  normalize: { start: 45, end: 50 },
  classify: { start: 50, end: 55 },
  enrich: { start: 55, end: 75 },
  link: { start: 75, end: 79 },
  validate: { start: 79, end: 83 },
  govern: { start: 83, end: 85 },
  compress: { start: 85, end: 95 },
  emit: { start: 95, end: 100 }
}

export interface ProgressFormatter {
  format(event: ContextProgressEvent): string
}

/** Create a stateful formatter that maps compile lifecycle events to weighted progress. */
export function createProgressFormatter(options: ProgressFormatterOptions): ProgressFormatter {
  const componentsByStage = new Map<PipelineStage, string[]>()
  let currentPercent = 0

  return {
    format(event) {
      if (event.stream) {
        return event.message
      }

      if (event.type === 'stage.started' && event.stage) {
        const components = event.metadata?.components
        if (Array.isArray(components)) {
          componentsByStage.set(event.stage, components.filter((component): component is string => typeof component === 'string'))
        }
      }

      const progress = progressForEvent(event, componentsByStage, currentPercent)
      currentPercent = progress.percent
      const message = legacyProgressMessage(event, progress.indeterminate)
      if (options.style === 'bar') {
        return renderBar(progress.percent, progress.indeterminate, labelForBar(event, message), options.width ?? 28, event.type === 'compile.completed')
      }
      return `${renderPercent(progress.percent)} ${message}`
    }
  }
}

function progressForEvent(
  event: ContextProgressEvent,
  componentsByStage: Map<PipelineStage, string[]>,
  fallbackPercent: number
): { percent: number; indeterminate: boolean } {
  if (event.type === 'compile.started') {
    return { percent: 0, indeterminate: false }
  }
  if (event.type === 'compile.completed') {
    return { percent: 100, indeterminate: false }
  }
  if (event.type.startsWith('adapter.install.')) {
    return { percent: fallbackPercent, indeterminate: true }
  }
  if (!event.stage) {
    return { percent: fallbackPercent, indeterminate: false }
  }
  const range = STAGE_RANGES[event.stage]
  if (!range) {
    return { percent: fallbackPercent, indeterminate: false }
  }
  if (event.type === 'stage.started') {
    return { percent: range.start, indeterminate: false }
  }
  if (event.type === 'stage.completed') {
    return { percent: range.end, indeterminate: false }
  }
  if (event.type === 'component.started' || event.type === 'component.completed' || event.type === 'component.failed') {
    return { percent: componentPercent(event, componentsByStage.get(event.stage) ?? [], range), indeterminate: false }
  }
  return { percent: fallbackPercent, indeterminate: false }
}

function componentPercent(event: ContextProgressEvent, components: string[], range: StageRange): number {
  if (!event.componentId || components.length === 0) {
    return range.start
  }
  const index = Math.max(0, components.indexOf(event.componentId))
  const width = range.end - range.start
  const completedOffset = event.type === 'component.completed' ? 1 : 0
  return Math.round(range.start + ((index + completedOffset) / components.length) * width)
}

function legacyProgressMessage(event: ContextProgressEvent, indeterminate = false): string {
  const suffix = indeterminate ? ' ...' : ''
  switch (event.type) {
    case 'compile.started':
      return '[compile] started\n'
    case 'compile.completed':
      return `[compile] completed${formatCounts(event)}\n`
    case 'stage.started':
      return `[compile] stage ${event.stage ?? 'unknown'} started\n`
    case 'stage.completed':
      return `[compile] stage ${event.stage ?? 'unknown'} completed${formatCounts(event)}\n`
    case 'component.started':
      return `[compile] component ${event.componentId ?? 'unknown'} started\n`
    case 'component.completed':
      return `[compile] component ${event.componentId ?? 'unknown'} completed${formatCounts(event)}\n`
    case 'component.failed':
      return `[compile] component ${event.componentId ?? 'unknown'} failed: ${event.message}\n`
    case 'adapter.install.batch.started':
      return `[adapter] install batch started${typeof event.metadata?.adapters === 'number' ? ` (${event.metadata.adapters} adapters)` : ''}${suffix}\n`
    case 'adapter.install.adapter.started':
      return `[adapter] ${event.adapterId ?? 'unknown'} runtime check${suffix}\n`
    case 'adapter.install.skipped':
      return `[adapter] ${event.adapterId ?? 'unknown'} no managed install required\n`
    case 'adapter.install.batch.completed':
      return `[adapter] install batch completed${typeof event.metadata?.adapters === 'number' ? ` (${event.metadata.adapters} adapters)` : ''}\n`
    case 'adapter.install.started':
      return `[adapter] ${event.adapterId ?? 'unknown'} install started${suffix}\n`
    case 'adapter.install.command.started':
      return `[adapter] ${event.adapterId ?? 'unknown'} $ ${event.command ? formatRuntimeCommand(event.command) : event.message}${suffix}\n`
    case 'adapter.install.command.completed':
      return `[adapter] ${event.adapterId ?? 'unknown'} command completed\n`
    case 'adapter.install.completed':
      return `[adapter] ${event.adapterId ?? 'unknown'} install completed\n`
    case 'adapter.install.failed':
      return `[adapter] ${event.adapterId ?? 'unknown'} install failed: ${event.message}\n`
    default:
      return event.message.endsWith('\n') ? event.message : `${event.message}\n`
  }
}

function renderPercent(percent: number): string {
  return `[${String(clampPercent(percent)).padStart(3, ' ')}%]`
}

function renderBar(percent: number, indeterminate: boolean, label: string, width: number, final: boolean): string {
  const clamped = clampPercent(percent)
  const filled = Math.round((clamped / 100) * width)
  const bar = `${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}`
  return `\r[${bar}] ${String(clamped).padStart(3, ' ')}% ${label}${indeterminate ? ' ...' : ''}${final ? '\n' : ''}`
}

function labelForBar(event: ContextProgressEvent, fallback: string): string {
  if (event.type === 'compile.started') {
    return 'Compile started'
  }
  if (event.type === 'compile.completed') {
    return `Compile completed${formatCounts(event)}`
  }
  if (event.stage) {
    return event.componentId ? `${event.stage} · ${event.componentId}` : event.stage
  }
  if (event.adapterId) {
    return event.adapterId
  }
  return fallback.replace(/\n$/, '')
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function formatCounts(event: ContextProgressEvent): string {
  const metadata = event.metadata ?? {}
  const parts = [
    typeof metadata.nodes === 'number' ? `${metadata.nodes} nodes` : undefined,
    typeof metadata.facts === 'number' ? `${metadata.facts} facts` : undefined,
    typeof metadata.edges === 'number' ? `${metadata.edges} edges` : undefined,
    typeof metadata.diagnostics === 'number' ? `${metadata.diagnostics} diagnostics` : undefined
  ].filter(Boolean)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

function formatRuntimeCommand(command: NonNullable<ContextProgressEvent['command']>): string {
  return [command.command, ...command.args].join(' ')
}
