import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildRuntimeTraceEvent,
  buildSourceFingerprints,
  buildContextRuntimeWorkspace,
  defineComponent,
  writeContextRuntimeWorkspace,
  writeGraphFiles,
  type ContextComponent,
  type ContextRuntimePlan,
  type OutputArtifact
} from '@context-compiler/core'

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
      await writeGraphFiles(state.graph, context.outputDir)
      await writePacks(state, context.outputDir)
      const runtimePlan = isRuntimePlan(state.artifacts.runtimePlan) ? state.artifacts.runtimePlan : undefined
      const runtimeWorkspace = buildContextRuntimeWorkspace(state.graph, context.config, state.packs, {
        pipelineId: context.pipelineId,
        plan: runtimePlan
      })
      await writeContextRuntimeWorkspace(context.outputDir, runtimeWorkspace)
      await writeFile(join(context.outputDir, 'context-manifest.json'), `${JSON.stringify(runtimeWorkspace.manifest, null, 2)}\n`)
      const sourceFingerprints = buildSourceFingerprints(state.rawArtifacts)
      const trace = buildRuntimeTraceEvent({
        pipeline: context.pipelineId,
        sourceFingerprints,
        diagnostics: runtimeWorkspace.plan.diagnostics,
        emittedArtifacts: [
          '.context/context-manifest.json',
          '.context/runtime/runtime.config.json',
          '.context/runtime/runtime-plan.json',
          '.context/runtime/agent-install-plan.json',
          '.context/runtime/trace.jsonl',
          '.context/runtime/run-summary.json'
        ]
      })
      await writeRuntimeTrace(context.outputDir, existingTrace, trace)

      const outputArtifacts: OutputArtifact[] = [
        {
          id: 'output:context-manifest',
          kind: 'output',
          path: join(context.outputDir, 'context-manifest.json'),
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

async function writeRuntimeTrace(outputDir: string, existingTrace: string | undefined, trace: ReturnType<typeof buildRuntimeTraceEvent>): Promise<void> {
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
