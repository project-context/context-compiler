import { createContextFactsClassifyComponent } from '@context-compiler/builtin-classify-context-facts'
import { createContextViewCompressComponent } from '@context-compiler/builtin-compress-context-view'
import { createRuntimePlanCompressComponent } from '@context-compiler/builtin-compress-runtime-plan'
import { createTaskContextCompressComponent } from '@context-compiler/builtin-compress-task-context'
import { createFilesEmitComponent } from '@context-compiler/builtin-emit-files'
import { createInventoryEnrichComponent } from '@context-compiler/builtin-enrich-inventory'
import { createScopeAdaptersEnrichComponent } from '@context-compiler/builtin-enrich-scope-adapters'
import { createRedactionGovernComponent } from '@context-compiler/builtin-govern-redaction'
import { createLocalFilesIngestComponent } from '@context-compiler/builtin-ingest-local-files'
import { createDefaultRulesLinkComponent } from '@context-compiler/builtin-link-default-rules'
import { createMarkdownDocNormalizeComponent } from '@context-compiler/builtin-normalize-markdown-doc'
import { createOpenApiContractNormalizeComponent } from '@context-compiler/builtin-normalize-openapi-contract'
import { createDocumentExtractorsParseComponent } from '@context-compiler/builtin-parse-document-extractors'
import { createMarkdownParseComponent } from '@context-compiler/builtin-parse-markdown'
import { createOpenApiParseComponent } from '@context-compiler/builtin-parse-openapi'
import { createDefaultRulesValidateComponent } from '@context-compiler/builtin-validate-default-rules'
import { type ContextDistribution, type ContextProjectConfig, type PipelineDefinition, type SourceConfig } from '@context-compiler/core/sdk'
import { codeGraphExtension, createCodeGraphAdapter } from '@context-compiler/extension-graph-codegraph'
import { createMicrosoftGraphRagAdapter, createMockMicrosoftGraphRagRuntime, microsoftGraphRagExtension } from '@context-compiler/extension-graph-microsoft-graphrag'
import { createDoclingDocumentExtractorAdapter, doclingExtension } from '@context-compiler/extension-parser-docling'

export const BUILTIN_LOCAL_PIPELINES: Record<string, PipelineDefinition> = {
  compile: {
    id: 'compile',
    stages: {
      ingest: ['ingest.local-files'],
      parse: ['parse.document-extractors', 'parse.markdown', 'parse.openapi'],
      normalize: ['normalize.markdown-doc', 'normalize.openapi-contract'],
      classify: ['classify.context-facts'],
      enrich: ['enrich.inventory', 'enrich.scope-adapters'],
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

/** Create the built-in source-first Graph-of-Graphs distribution used by CLI/MCP. */
export function createBuiltinLocalDistribution(): ContextDistribution {
  const autoPlanner = new BuiltinLocalPipelineAutoPlanner()
  const codeGraphAdapter = createCodeGraphAdapter()
  const graphRagAdapter = createLocalGraphRagAdapter()
  return {
    id: '@context-compiler/builtin-local',
    version: '0.1.0',
    metadata: {
      architecture: 'source-first-graph-of-graphs',
      phases: ['inventory', 'triage', 'agent-plan', 'scope-build', 'normalize-link-validate-govern', 'materialize']
    },
    components: [
      createLocalFilesIngestComponent(),
      createDocumentExtractorsParseComponent({ documentExtractors: [createDoclingDocumentExtractorAdapter()] }),
      createMarkdownParseComponent(),
      createOpenApiParseComponent(),
      createMarkdownDocNormalizeComponent(),
      createOpenApiContractNormalizeComponent(),
      createContextFactsClassifyComponent(),
      createInventoryEnrichComponent(),
      createScopeAdaptersEnrichComponent({ graphAdapters: [codeGraphAdapter, graphRagAdapter] }),
      createDefaultRulesLinkComponent(),
      createDefaultRulesValidateComponent(),
      createRedactionGovernComponent(),
      createContextViewCompressComponent(),
      createTaskContextCompressComponent(),
      createRuntimePlanCompressComponent(),
      createFilesEmitComponent()
    ],
    pipelines: BUILTIN_LOCAL_PIPELINES,
    graphAdapters: [codeGraphAdapter, graphRagAdapter],
    documentExtractors: [createDoclingDocumentExtractorAdapter()],
    extensions: [codeGraphExtension, microsoftGraphRagExtension, doclingExtension],
    planPipeline: (config, pipelineId) => autoPlanner.plan(config, pipelineId)
  }
}

function createLocalGraphRagAdapter() {
  return createMicrosoftGraphRagAdapter(
    process.env.CONTEXT_GRAPHRAG_RUNTIME === 'mock'
      ? { runtime: createMockMicrosoftGraphRagRuntime() }
      : {}
  )
}

export class BuiltinLocalPipelineAutoPlanner {
  plan(config: ContextProjectConfig, pipelineId: string): PipelineDefinition | undefined {
    if (pipelineId === 'sync') {
      return BUILTIN_LOCAL_PIPELINES.sync
    }
    if (pipelineId !== 'compile') {
      return undefined
    }

    const hasAuto = config.sources.some(isAutoSource)
    const hasMarkdown = hasAuto || config.sources.some(isMarkdownSource)
    const hasOpenApi = hasAuto || config.sources.some(isOpenApiSource)
    const hasCode = hasAuto || config.sources.some(isCodeSource)
    const hasDocuments = hasAuto || config.sources.some(isComplexDocumentSource)
    const hasParsedSources = hasMarkdown || hasOpenApi || hasDocuments

    return {
      id: 'compile',
      stages: {
        ingest: ['ingest.local-files'],
        ...(hasParsedSources || hasDocuments ? { parse: [...(hasDocuments ? ['parse.document-extractors'] : []), ...(hasMarkdown ? ['parse.markdown'] : []), ...(hasOpenApi ? ['parse.openapi'] : [])] } : {}),
        ...(hasParsedSources ? { normalize: [...(hasMarkdown || hasDocuments ? ['normalize.markdown-doc'] : []), ...(hasOpenApi ? ['normalize.openapi-contract'] : [])] } : {}),
        ...(hasParsedSources ? { classify: ['classify.context-facts'] } : {}),
        enrich: ['enrich.inventory', ...(hasCode || hasMarkdown || hasDocuments ? ['enrich.scope-adapters'] : [])],
        link: ['link.default-rules'],
        validate: ['validate.default-rules'],
        govern: ['govern.redaction'],
        compress: ['compress.context-view', 'compress.task-context', 'compress.runtime-plan'],
        emit: ['emit.files']
      }
    }
  }
}

/** Backward-compatible alias inside the built-in package. */
export const createBuiltinDistribution = createBuiltinLocalDistribution

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

function isAutoSource(source: SourceConfig): boolean {
  return source.type === undefined || source.type === 'auto'
}

function isComplexDocumentSource(source: SourceConfig): boolean {
  return (
    source.parser === 'docling' ||
    source.mediaType === 'application/pdf' ||
    source.mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    source.mediaType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    source.mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    /\.(pdf|docx|pptx|xlsx|png|jpe?g|tiff?)$/i.test(source.path)
  )
}
