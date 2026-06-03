import { createContextFactsClassifyComponent } from '@context-compiler/classify-context-facts'
import { createContextViewCompressComponent } from '@context-compiler/compress-context-view'
import { createRuntimePlanCompressComponent } from '@context-compiler/compress-runtime-plan'
import { createTaskContextCompressComponent } from '@context-compiler/compress-task-context'
import { createFilesEmitComponent } from '@context-compiler/emit-files'
import { createInventoryEnrichComponent } from '@context-compiler/enrich-inventory'
import { createSymbolIndexEnrichComponent } from '@context-compiler/enrich-symbol-index'
import { createRedactionGovernComponent } from '@context-compiler/govern-redaction'
import { createLocalFilesIngestComponent } from '@context-compiler/ingest-local-files'
import { createDefaultRulesLinkComponent } from '@context-compiler/link-default-rules'
import { createMarkdownDocNormalizeComponent } from '@context-compiler/normalize-markdown-doc'
import { createOpenApiContractNormalizeComponent } from '@context-compiler/normalize-openapi-contract'
import { createMarkdownParseComponent } from '@context-compiler/parse-markdown'
import { createOpenApiParseComponent } from '@context-compiler/parse-openapi'
import { createDefaultRulesValidateComponent } from '@context-compiler/validate-default-rules'
import type { ContextDistribution, ContextProjectConfig, PipelineDefinition, SourceConfig } from '@context-compiler/core'

export const LOCAL_MANUAL_PIPELINES: Record<string, PipelineDefinition> = {
  compile: {
    id: 'compile',
    stages: {
      ingest: ['ingest.local-files'],
      parse: ['parse.markdown', 'parse.openapi'],
      normalize: ['normalize.markdown-doc', 'normalize.openapi-contract'],
      classify: ['classify.context-facts'],
      enrich: ['enrich.inventory', 'enrich.symbol-index'],
      link: ['link.default-rules'],
      validate: ['validate.default-rules'],
      govern: ['govern.redaction'],
      compress: ['compress.context-view', 'compress.task-context', 'compress.runtime-plan'],
      emit: ['emit.files']
    }
  },
  sync: {
    id: 'sync',
    stages: {
      ingest: ['ingest.local-files']
    }
  }
}

/** Create the official local distribution used by the CLI MVP. */
export function createLocalDistribution(): ContextDistribution {
  const autoPlanner = new LocalPipelineAutoPlanner()
  return {
    id: '@context-compiler/distribution-local',
    version: '0.1.0',
    components: [
      createLocalFilesIngestComponent(),
      createMarkdownParseComponent(),
      createOpenApiParseComponent(),
      createMarkdownDocNormalizeComponent(),
      createOpenApiContractNormalizeComponent(),
      createContextFactsClassifyComponent(),
      createInventoryEnrichComponent(),
      createSymbolIndexEnrichComponent(),
      createDefaultRulesLinkComponent(),
      createDefaultRulesValidateComponent(),
      createRedactionGovernComponent(),
      createContextViewCompressComponent(),
      createTaskContextCompressComponent(),
      createRuntimePlanCompressComponent(),
      createFilesEmitComponent()
    ],
    pipelines: LOCAL_MANUAL_PIPELINES,
    planPipeline: (config, pipelineId) => autoPlanner.plan(config, pipelineId)
  }
}

export class LocalPipelineAutoPlanner {
  plan(config: ContextProjectConfig, pipelineId: string): PipelineDefinition | undefined {
    if (pipelineId === 'sync') {
      return LOCAL_MANUAL_PIPELINES.sync
    }
    if (pipelineId !== 'compile') {
      return undefined
    }

    const hasMarkdown = config.sources.some(isMarkdownSource)
    const hasOpenApi = config.sources.some(isOpenApiSource)
    const hasCode = config.sources.some(isCodeSource)
    const hasParsedSources = hasMarkdown || hasOpenApi

    return {
      id: 'compile',
      stages: {
        ingest: ['ingest.local-files'],
        ...(hasParsedSources ? { parse: [...(hasMarkdown ? ['parse.markdown'] : []), ...(hasOpenApi ? ['parse.openapi'] : [])] } : {}),
        ...(hasParsedSources ? { normalize: [...(hasMarkdown ? ['normalize.markdown-doc'] : []), ...(hasOpenApi ? ['normalize.openapi-contract'] : [])] } : {}),
        ...(hasParsedSources ? { classify: ['classify.context-facts'] } : {}),
        enrich: ['enrich.inventory', ...(hasCode ? ['enrich.symbol-index'] : [])],
        link: ['link.default-rules'],
        validate: ['validate.default-rules'],
        govern: ['govern.redaction'],
        compress: ['compress.context-view', 'compress.task-context', 'compress.runtime-plan'],
        emit: ['emit.files']
      }
    }
  }
}

function isMarkdownSource(source: SourceConfig): boolean {
  return source.type === 'markdown' || source.parser === 'markdown' || source.mediaType === 'text/markdown' || /\.mdx?$/i.test(source.path)
}

function isOpenApiSource(source: SourceConfig): boolean {
  return source.type === 'openapi' || source.parser === 'openapi' || source.mediaType === 'application/openapi'
}

function isCodeSource(source: SourceConfig): boolean {
  return (
    source.type === 'code' ||
    source.type === 'git' ||
    source.parser === 'code' ||
    source.mediaType === 'text/typescript' ||
    source.mediaType === 'text/javascript' ||
    /\.(tsx?|jsx?)$/i.test(source.path)
  )
}
