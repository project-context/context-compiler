import { describe, expect, it } from 'vitest'
import {
  ComponentRegistry,
  PipelinePlanner,
  PipelineRunner,
  compileContextProject,
  createDiagnostic,
  defineComponent,
  defineContextProject,
  emptyPipelineState
} from '@context-compiler/core'

describe('pipeline component architecture', () => {
  it('registers components by stable stage and rejects duplicate ids', () => {
    const component = defineComponent({
      manifest: {
        id: 'test.ingest.memory',
        stage: 'ingest',
        version: '0.1.0',
        apiVersion: 'v1',
        stability: 'development',
        inputs: ['source-config'],
        outputs: ['raw-artifact'],
        deterministic: true,
        requiresNetwork: false,
        cacheable: true
      },
      async process() {
        return { rawArtifacts: [] }
      }
    })

    const registry = new ComponentRegistry([component])

    expect(registry.get('test.ingest.memory')).toBe(component)
    expect(registry.byStage('ingest')).toEqual([component])
    expect(() => new ComponentRegistry([component, component])).toThrow(/Duplicate component id/)
  })

  it('plans only components that belong to the requested stage', () => {
    const ingest = defineComponent({
      manifest: {
        id: 'test.ingest.memory',
        stage: 'ingest',
        version: '0.1.0',
        apiVersion: 'v1',
        stability: 'development',
        inputs: ['source-config'],
        outputs: ['raw-artifact'],
        deterministic: true,
        requiresNetwork: false,
        cacheable: true
      },
      async process() {
        return { rawArtifacts: [] }
      }
    })
    const registry = new ComponentRegistry([ingest])

    expect(() =>
      new PipelinePlanner(registry).plan({
        id: 'bad-pipeline',
        stages: {
          parse: ['test.ingest.memory']
        }
      })
    ).toThrow(/stage "parse"/)
  })

  it('uses distribution auto plans before manual fallback pipelines', async () => {
    const ingest = defineComponent({
      manifest: {
        id: 'test.ingest.memory',
        stage: 'ingest',
        version: '0.1.0',
        apiVersion: 'v1',
        stability: 'development',
        inputs: ['source-config'],
        outputs: ['raw-artifact'],
        deterministic: true,
        requiresNetwork: false,
        cacheable: true
      },
      async process() {
        return { rawArtifacts: [] }
      }
    })

    const result = await compileContextProject({
      rootDir: '/workspace',
      config: { sources: [] },
      distribution: {
        id: 'test.distribution',
        version: '0.1.0',
        components: [ingest],
        pipelines: {
          compile: {
            id: 'compile',
            stages: {
              ingest: ['missing.manual-component']
            }
          }
        },
        planPipeline() {
          return {
            id: 'compile',
            stages: {
              ingest: ['test.ingest.memory']
            }
          }
        }
      }
    })

    expect(result.graph.nodes).toEqual([])
  })

  it('runs components in stage order and aggregates diagnostics', async () => {
    const events: string[] = []
    const registry = new ComponentRegistry([
      defineComponent({
        manifest: {
          id: 'test.ingest.memory',
          stage: 'ingest',
          version: '0.1.0',
          apiVersion: 'v1',
          stability: 'development',
          inputs: ['source-config'],
          outputs: ['raw-artifact'],
          deterministic: true,
          requiresNetwork: false,
          cacheable: true
        },
        async process() {
          events.push('ingest')
          return {
            rawArtifacts: [
              {
                id: 'raw:doc',
                kind: 'raw',
                mediaType: 'text/plain',
                content: 'hello',
                source: { uri: 'memory://doc', type: 'memory' }
              }
            ]
          }
        }
      }),
      defineComponent({
        manifest: {
          id: 'test.parse.memory',
          stage: 'parse',
          version: '0.1.0',
          apiVersion: 'v1',
          stability: 'development',
          inputs: ['raw-artifact'],
          outputs: ['parsed-artifact'],
          deterministic: true,
          requiresNetwork: false,
          cacheable: true
        },
        async process(state) {
          events.push(`parse:${state.rawArtifacts.length}`)
          return {
            diagnostics: [
              createDiagnostic({
                severity: 'info',
                code: 'test.info',
                message: 'parsed memory artifact'
              })
            ]
          }
        }
      })
    ])

    const result = await new PipelineRunner(new PipelinePlanner(registry)).run({
      definition: {
        id: 'memory',
        stages: {
          ingest: ['test.ingest.memory'],
          parse: ['test.parse.memory']
        }
      },
      context: {
        rootDir: process.cwd(),
        outputDir: '.context',
        config: defineContextProject({ sources: [] }, { rootDir: process.cwd() })
      },
      initialState: emptyPipelineState()
    })

    expect(events).toEqual(['ingest', 'parse:1'])
    expect(result.state.rawArtifacts).toHaveLength(1)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['test.info'])
  })
})
