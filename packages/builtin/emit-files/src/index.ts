import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRuntimeTraceEvent, buildSourceFingerprints, buildSourceFingerprintsFromInventory, buildContextRuntimeWorkspace, writeContextRuntimeWorkspace } from '@context-compiler/core/runtime'
import { ensureGraphFactProvenance, writeGraphFiles } from '@context-compiler/core/graph'
import { defineComponent, type ContextComponent, type EvidenceReport, type ContextSourceInventory, type ContextRuntimePlan, type AdapterRuntimeStatus, type OutputArtifact } from '@context-compiler/core/sdk'

/** Create the default file emitter for `.context` artifacts. */
export function createFilesEmitComponent(): ContextComponent {
  return defineComponent({
    manifest: {
      id: 'emit.files',
      stage: 'emit',
      version: '0.1.0',
      apiVersion: 'v1',
      stability: 'development',
      inputs: ['context-graph', 'context-pack'],
      outputs: ['output-artifact:file'],
      deterministic: true,
      requiresNetwork: false,
      cacheable: true
    },
    async process(state, context) {
      await mkdir(context.outputDir, { recursive: true })
      const existingTrace = await readOptionalFile(join(context.outputDir, 'runtime', 'trace.jsonl'))
      const runtimePlan = isRuntimePlan(state.artifacts.runtimePlan) ? state.artifacts.runtimePlan : undefined
      const sourceInventory = isSourceInventory(state.artifacts.sourceInventory) ? state.artifacts.sourceInventory : undefined
      const evidenceReports = isEvidenceReports(state.artifacts.evidenceReports) ? mergeById(state.artifacts.evidenceReports) : []
      const adapterRuntimeStatuses = mergeAdapterRuntimeStatuses([
        ...adapterRuntimeStatusesFromArtifact(state.artifacts.documentExtractorRuntimeStatuses),
        ...adapterRuntimeStatusesFromArtifact(state.artifacts.graphAdapterRuntimeStatuses)
      ])
      const graph = ensureGraphFactProvenance(state.graph)
      await writeGraphFiles(graph, context.outputDir, { sourceInventory })
      await writePacks(state, context.outputDir)
      const runtimeWorkspace = buildContextRuntimeWorkspace(graph, context.config, state.packs, {
        pipelineId: context.pipelineId,
        plan: runtimePlan,
        sourceInventory,
        evidenceReports
      })
      await writeContextRuntimeWorkspace(context.outputDir, runtimeWorkspace)
      const sourceFingerprints = sourceInventory ? buildSourceFingerprintsFromInventory(sourceInventory) : buildSourceFingerprints(state.rawArtifacts)
      const trace = buildRuntimeTraceEvent({
        pipeline: context.pipelineId,
        sourceFingerprints,
	        diagnostics: runtimeWorkspace.plan.diagnostics,
	        emittedArtifacts: [
	          '.context/manifest.json',
	          '.context/sources/inventory.jsonl',
          '.context/sources/routes.jsonl',
          '.context/sources/unsupported.jsonl',
          '.context/sources/summary.json',
          '.context/sources/packages.jsonl',
          '.context/sources/build-units.jsonl',
          '.context/graph/global/nodes.jsonl',
          '.context/graph/global/edges.jsonl',
          '.context/graph/evidence-reports.jsonl',
          '.context/graph/scopes/manifest.json',
          '.context/indexes/manifest.json',
          '.context/runtime/runtime.config.json',
          '.context/runtime/runtime-plan.json',
          '.context/runtime/agent-install-plan.json',
          '.context/runtime/trace.jsonl',
          '.context/runtime/run-summary.json'
        ]
      })
      await writeRuntimeTrace(context.outputDir, existingTrace, trace, adapterRuntimeStatuses)

      const outputArtifacts: OutputArtifact[] = [
        {
          id: 'output:manifest',
          kind: 'output',
          path: join(context.outputDir, 'manifest.json'),
          mediaType: 'application/json',
          metadata: {}
        }
      ]
      return { outputArtifacts }
    }
  })
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

async function writeRuntimeTrace(
  outputDir: string,
  existingTrace: string | undefined,
  trace: ReturnType<typeof buildRuntimeTraceEvent>,
  adapterRuntimeStatuses: AdapterRuntimeStatus[] = []
): Promise<void> {
  const runtimeDir = join(outputDir, 'runtime')
  await mkdir(runtimeDir, { recursive: true })
  const prior = existingTrace?.trim()
  await writeFile(join(runtimeDir, 'trace.jsonl'), `${prior ? `${prior}\n` : ''}${JSON.stringify(trace)}\n`)
  await writeFile(
    join(runtimeDir, 'run-summary.json'),
    `${JSON.stringify(
      {
        schemaVersion: 'context-runtime-run-summary.v1',
        generatedAt: trace.generatedAt,
        pipeline: trace.pipeline,
        traceId: trace.id,
        sourceFingerprints: trace.sourceFingerprints,
        adapterRuntimeStatuses,
        freshness: { status: 'fresh', checkedAt: trace.generatedAt }
      },
      null,
      2
    )}\n`
  )
}

async function writePacks(state: Parameters<NonNullable<ContextComponent['process']>>[0], outputDir: string): Promise<void> {
  const viewsDir = join(outputDir, 'views')
  await rm(viewsDir, { recursive: true, force: true })
  await mkdir(viewsDir, { recursive: true })
  for (const pack of state.packs) {
    if (pack.kind === 'context-view' && pack.view) {
      await writeFile(join(viewsDir, `${pack.view}.md`), pack.content)
    }
  }
}

function isRuntimePlan(value: unknown): value is ContextRuntimePlan {
  return Boolean(value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 'context-runtime-plan.v1')
}

function isSourceInventory(value: unknown): value is ContextSourceInventory {
  return Boolean(value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 'context-source-inventory.v1')
}

function isEvidenceReports(value: unknown): value is EvidenceReport[] {
  return Array.isArray(value) && value.every((record) => record && typeof record === 'object' && 'schemaVersion' in record && record.schemaVersion === 'context-evidence-report.v1')
}

function adapterRuntimeStatusesFromArtifact(value: unknown): AdapterRuntimeStatus[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((record): record is AdapterRuntimeStatus =>
    Boolean(record && typeof record === 'object' && 'schemaVersion' in record && record.schemaVersion === 'context-adapter-runtime-status.v1')
  )
}

function mergeById<T extends { id: string }>(records: T[]): T[] {
  return [...new Map(records.map((record) => [record.id, record])).values()]
}

function mergeAdapterRuntimeStatuses(records: AdapterRuntimeStatus[]): AdapterRuntimeStatus[] {
  return [...new Map(records.map((record) => [record.adapterId, record])).values()]
}
